import { createServer, type Server } from 'http';
import { shell } from 'electron';
import {
  PublicClientApplication,
  type Configuration,
  type AccountInfo as MsalAccountInfo,
  CryptoProvider
} from '@azure/msal-node';
import { config } from '../config';
import { logger } from '../logger';
import { EncryptedTokenCachePlugin } from './tokenCache';
import type { AccountInfo } from '../../shared/types';
import { SyncError } from '../utils/errors';

export const GRAPH_SCOPES = ['User.Read', 'Files.Read', 'offline_access'];

export class AuthService {
  private pca: PublicClientApplication | null = null;
  private cachePlugin: EncryptedTokenCachePlugin;
  private cryptoProvider: CryptoProvider;
  private activeAccount: MsalAccountInfo | null = null;
  private pendingLoopbackServer: Server | null = null;
  private pendingProtocolHandler: ((url: string) => void) | null = null;

  constructor(cachePlugin?: EncryptedTokenCachePlugin) {
    this.cachePlugin = cachePlugin ?? new EncryptedTokenCachePlugin();
    this.cryptoProvider = new CryptoProvider();
  }

  public async init(): Promise<void> {
    if (this.pca) return;

    const msalConfig: Configuration = {
      auth: {
        clientId: config.msClientId,
        authority: config.msAuthority
      },
      cache: {
        cachePlugin: this.cachePlugin
      }
    };

    this.pca = new PublicClientApplication(msalConfig);

    const accounts = await this.pca.getTokenCache().getAllAccounts();
    if (accounts.length > 0 && accounts[0]) {
      this.activeAccount = accounts[0];
    }
  }

  public async getAccessToken(): Promise<string> {
    await this.init();
    if (!this.pca) throw new Error('MSAL not initialized');

    if (!this.activeAccount) {
      const accounts = await this.pca.getTokenCache().getAllAccounts();
      if (accounts.length > 0 && accounts[0]) {
        this.activeAccount = accounts[0];
      }
    }

    if (!this.activeAccount) {
      throw new SyncError({
        code: 'AUTH_EXPIRED',
        message: 'No active account signed in',
        retriable: false
      });
    }

    try {
      const response = await this.pca.acquireTokenSilent({
        account: this.activeAccount,
        scopes: GRAPH_SCOPES
      });

      if (!response || !response.accessToken) {
        throw new Error('Empty token response');
      }

      return response.accessToken;
    } catch (err) {
      logger.warn('Silent token refresh failed, interactive login required:', err);
      throw new SyncError({
        code: 'AUTH_EXPIRED',
        message: 'Authentication session expired, interactive sign-in needed',
        retriable: false,
        cause: err
      });
    }
  }

  public async signInInteractive(): Promise<AccountInfo> {
    await this.init();
    if (!this.pca) throw new Error('MSAL not initialized');

    this.cancelPendingSignIn();

    const { verifier, challenge } = await this.cryptoProvider.generatePkceCodes();

    return new Promise((resolve, reject) => {
      let resolvedOrRejected = false;
      let timeoutId: NodeJS.Timeout | null = null;

      const finishResolve = (account: AccountInfo): void => {
        if (!resolvedOrRejected) {
          resolvedOrRejected = true;
          if (timeoutId) clearTimeout(timeoutId);
          this.cancelPendingSignIn();
          resolve(account);
        }
      };

      const finishReject = (error: Error): void => {
        if (!resolvedOrRejected) {
          resolvedOrRejected = true;
          if (timeoutId) clearTimeout(timeoutId);
          this.cancelPendingSignIn();
          reject(error);
        }
      };

      // 2-minute safety timeout to prevent hanging IPC
      timeoutId = setTimeout(() => {
        finishReject(new Error('Sign-in timed out. Please try again.'));
      }, 120000);

      const isLoopback = config.msRedirectUri.startsWith('http://') || config.msRedirectUri.startsWith('https://');

      if (!isLoopback) {
        // Custom protocol scheme (e.g. onesync://auth, dev.sibansal.onesync://auth, msal<client_id>://auth)
        this.pendingProtocolHandler = async (incomingUrl: string) => {
          try {
            const parsed = new URL(incomingUrl);
            const code = parsed.searchParams.get('code');
            const error = parsed.searchParams.get('error');
            const errorDesc = parsed.searchParams.get('error_description');

            if (error) {
              finishReject(new Error(`OAuth error: ${error} - ${errorDesc ?? ''}`));
              return;
            }

            if (code) {
              const tokenResponse = await this.pca!.acquireTokenByCode({
                code,
                scopes: GRAPH_SCOPES,
                redirectUri: config.msRedirectUri,
                codeVerifier: verifier
              });

              this.activeAccount = tokenResponse.account;
              finishResolve({
                id: tokenResponse.account?.homeAccountId || tokenResponse.account?.localAccountId || 'unknown',
                name: tokenResponse.account?.name || 'OneDrive User',
                email: tokenResponse.account?.username || ''
              });
            }
          } catch (err) {
            finishReject(err instanceof Error ? err : new Error(String(err)));
          }
        };

        this.pca!
          .getAuthCodeUrl({
            scopes: GRAPH_SCOPES,
            redirectUri: config.msRedirectUri,
            codeChallenge: challenge,
            codeChallengeMethod: 'S256'
          })
          .then((authUrl) => shell.openExternal(authUrl))
          .catch((err) => finishReject(err instanceof Error ? err : new Error(String(err))));

        return;
      }

      const redirectUrlObj = new URL(config.msRedirectUri);
      const configuredPort = redirectUrlObj.port ? parseInt(redirectUrlObj.port, 10) : 53682;
      let port = configuredPort;

      const server = createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host}`);
          const code = reqUrl.searchParams.get('code');
          const error = reqUrl.searchParams.get('error');
          const errorDesc = reqUrl.searchParams.get('error_description');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<html><body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0d1117; color: #f0f6fc;">
              <h2 style="color: #f85149;">Authentication Failed</h2>
              <p>${error}: ${errorDesc ?? ''}</p>
              <p>You can close this tab and return to OneSync to try again.</p>
            </body></html>`);
            finishReject(new Error(`OAuth error: ${error} - ${errorDesc}`));
            return;
          }

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><body style="font-family: sans-serif; text-align: center; padding: 40px; background: #0d1117; color: #f0f6fc;">
              <h2 style="color: #2ea043;">Sign-in Successful!</h2>
              <p>You may now close this tab and return to <strong>OneSync</strong>.</p>
            </body></html>`);

            const redirectUri = config.msRedirectUri || `http://localhost:${port}`;
            const tokenResponse = await this.pca!.acquireTokenByCode({
              code,
              scopes: GRAPH_SCOPES,
              redirectUri,
              codeVerifier: verifier
            });

            this.activeAccount = tokenResponse.account;
            finishResolve({
              id: tokenResponse.account?.homeAccountId || tokenResponse.account?.localAccountId || 'unknown',
              name: tokenResponse.account?.name || 'OneDrive User',
              email: tokenResponse.account?.username || ''
            });
          }
        } catch (err) {
          finishReject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      this.pendingLoopbackServer = server;

      const startListening = (targetPort: number): void => {
        server.listen(targetPort, '127.0.0.1', async () => {
          const address = server.address();
          if (!address || typeof address === 'string') {
            finishReject(new Error('Failed to bind loopback server'));
            return;
          }

          port = address.port;
          const redirectUri = config.msRedirectUri || `http://localhost:${port}`;

          try {
            const authUrl = await this.pca!.getAuthCodeUrl({
              scopes: GRAPH_SCOPES,
              redirectUri,
              codeChallenge: challenge,
              codeChallengeMethod: 'S256'
            });

            await shell.openExternal(authUrl);
          } catch (err) {
            finishReject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      };

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port === configuredPort && configuredPort !== 0) {
          logger.warn(`Port ${configuredPort} is in use, falling back to random loopback port.`);
          startListening(0);
        } else {
          finishReject(err);
        }
      });

      startListening(configuredPort);
    });
  }

  public handleCustomSchemeUrl(url: string): void {
    if (this.pendingProtocolHandler) {
      this.pendingProtocolHandler(url);
    }
  }

  public cancelPendingSignIn(): void {
    this.pendingProtocolHandler = null;
    if (this.pendingLoopbackServer) {
      try {
        this.pendingLoopbackServer.close();
      } catch {
        // Ignore close error
      }
      this.pendingLoopbackServer = null;
    }
  }

  public async signOut(): Promise<void> {
    await this.init();
    if (this.pca && this.activeAccount) {
      await this.pca.getTokenCache().removeAccount(this.activeAccount);
      this.activeAccount = null;
    }
    this.cachePlugin.clear();
  }

  public async getAccount(): Promise<AccountInfo | null> {
    await this.init();
    if (!this.pca) return null;

    if (!this.activeAccount) {
      const accounts = await this.pca.getTokenCache().getAllAccounts();
      if (accounts.length > 0 && accounts[0]) {
        this.activeAccount = accounts[0];
      }
    }

    if (!this.activeAccount) return null;

    return {
      id: this.activeAccount.homeAccountId || this.activeAccount.localAccountId,
      name: this.activeAccount.name || 'OneDrive User',
      email: this.activeAccount.username
    };
  }
}
