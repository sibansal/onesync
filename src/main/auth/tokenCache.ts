import { app, safeStorage } from 'electron';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import type { ICachePlugin, TokenCacheContext } from '@azure/msal-node';
import { logger } from '../logger';

export class EncryptedTokenCachePlugin implements ICachePlugin {
  private cacheFilePath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.cacheFilePath = customPath;
    } else {
      let userData = '';
      try {
        if (app && typeof app.getPath === 'function') {
          userData = app.getPath('userData');
        }
      } catch {
        // Fallback in testing
      }
      if (!userData) {
        userData = process.env.TMPDIR || '/tmp';
      }
      this.cacheFilePath = join(userData, 'token-cache.bin');
    }
  }

  public async beforeCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (!existsSync(this.cacheFilePath)) {
      return;
    }

    try {
      const encryptedData = readFileSync(this.cacheFilePath);
      if (encryptedData.length === 0) return;

      let decryptedJson = '';
      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        decryptedJson = safeStorage.decryptString(encryptedData);
      } else {
        // Fallback for test/mock environments without macOS keychain access
        decryptedJson = encryptedData.toString('utf-8');
      }

      if (decryptedJson) {
        cacheContext.tokenCache.deserialize(decryptedJson);
      }
    } catch (err) {
      logger.error('Failed to read and decrypt token cache:', err);
    }
  }

  public async afterCacheAccess(cacheContext: TokenCacheContext): Promise<void> {
    if (!cacheContext.cacheHasChanged) {
      return;
    }

    try {
      const serialized = cacheContext.tokenCache.serialize();
      let outputBuffer: Buffer;

      if (safeStorage && safeStorage.isEncryptionAvailable()) {
        outputBuffer = safeStorage.encryptString(serialized);
      } else {
        outputBuffer = Buffer.from(serialized, 'utf-8');
      }

      writeFileSync(this.cacheFilePath, outputBuffer);
    } catch (err) {
      logger.error('Failed to encrypt and persist token cache:', err);
    }
  }

  public clear(): void {
    try {
      if (existsSync(this.cacheFilePath)) {
        unlinkSync(this.cacheFilePath);
      }
    } catch (err) {
      logger.error('Error clearing token cache file:', err);
    }
  }
}
