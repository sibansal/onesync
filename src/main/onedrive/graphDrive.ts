import { Readable } from 'stream';
import type { RemoteDrive } from './remoteDrive';
import { graphFetch } from './graphFetch';
import type { AuthService } from '../auth/authService';
import { config } from '../config';
import { SyncError } from '../utils/errors';
import type { RemoteItem, AccountInfo, DriveQuota } from '../../shared/types';
import { logger } from '../logger';

export class GraphDrive implements RemoteDrive {
  private authService: AuthService;

  constructor(authService: AuthService) {
    this.authService = authService;
  }

  public async getAccount(): Promise<AccountInfo> {
    const response = await graphFetch(`${config.graphBaseUrl}/me`, {}, this.authService);
    if (!response.ok) {
      throw new Error(`Failed to fetch account profile: HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      id: data.id,
      name: data.displayName || 'OneDrive User',
      email: data.userPrincipalName || data.mail || ''
    };
  }

  public async getQuota(): Promise<DriveQuota> {
    const response = await graphFetch(`${config.graphBaseUrl}/me/drive`, {}, this.authService);
    if (!response.ok) {
      throw new Error(`Failed to fetch drive quota: HTTP ${response.status}`);
    }

    const data = await response.json();
    return {
      used: data.quota?.used ?? 0,
      total: data.quota?.total ?? 0
    };
  }

  public async listChanges(
    deltaLink: string | null,
    onPage: (items: RemoteItem[]) => void,
    signal?: AbortSignal,
    checkPause?: () => Promise<void>
  ): Promise<{ deltaLink: string; isFullListing: boolean }> {
    let isFullListing = !deltaLink;
    const initialUrl =
      deltaLink ??
      `${config.graphBaseUrl}/me/drive/root/delta?$select=id,name,size,file,folder,parentReference,deleted,lastModifiedDateTime,eTag,cTag,package,remoteItem,root`;

    let nextUrl: string | null = initialUrl;
    let finalDeltaLink = '';

    while (nextUrl) {
      if (signal?.aborted) {
        throw new SyncError({
          code: 'CANCELLED',
          message: 'Sync was cancelled by user',
          retriable: false
        });
      }

      if (checkPause) {
        await checkPause();
      }

      if (signal?.aborted) {
        throw new SyncError({
          code: 'CANCELLED',
          message: 'Sync was cancelled by user',
          retriable: false
        });
      }

      const response = await graphFetch(nextUrl, { signal }, this.authService);

      // Handle 410 Gone: delta token expired -> fallback to full enumeration
      if (response.status === 410) {
        logger.warn('Delta link expired (HTTP 410 Gone). Performing full enumeration.');
        isFullListing = true;
        nextUrl = `${config.graphBaseUrl}/me/drive/root/delta?$select=id,name,size,file,folder,parentReference,deleted,lastModifiedDateTime,eTag,cTag,package,remoteItem,root`;
        continue;
      }

      if (!response.ok) {
        throw new Error(`Graph Delta listing failed: HTTP ${response.status}`);
      }

      const data = await response.json();
      const rawItems = Array.isArray(data.value) ? data.value : [];
      const parsedItems: RemoteItem[] = [];

      for (const raw of rawItems) {
        // Skip and count as unsupported: remote items, packages (OneNote)
        if (raw.remoteItem || raw.package) {
          continue;
        }

        const hashes = raw.file?.hashes;
        const sha256 = hashes?.sha256Hash;
        const sha1 = hashes?.sha1Hash;
        const quickXor = hashes?.quickXorHash;

        const hashType = sha256 ? 'sha256' : sha1 ? 'sha1' : quickXor ? 'quickXor' : null;
        const fingerprint = sha256 ?? sha1 ?? quickXor ?? raw.cTag ?? raw.eTag ?? null;

        parsedItems.push({
          id: raw.id,
          parentId: raw.parentReference?.id ?? null,
          name: raw.name,
          isFolder: Boolean(raw.folder),
          size: raw.size ?? 0,
          fingerprint,
          hashType,
          remoteModified: raw.lastModifiedDateTime ?? null,
          isDeleted: Boolean(raw.deleted)
        });
      }

      onPage(parsedItems);

      if (data['@odata.nextLink']) {
        nextUrl = data['@odata.nextLink'];
      } else if (data['@odata.deltaLink']) {
        finalDeltaLink = data['@odata.deltaLink'];
        nextUrl = null;
      } else {
        nextUrl = null;
      }
    }

    return {
      deltaLink: finalDeltaLink,
      isFullListing
    };
  }

  public async openDownload(
    item: RemoteItem,
    startByte = 0,
    signal?: AbortSignal
  ): Promise<{ stream: Readable; resumed: boolean; freshDownloadUrl?: string }> {
    // 1. Fetch fresh download URL
    const itemUrl = `${config.graphBaseUrl}/me/drive/items/${item.id}?$select=id,@microsoft.graph.downloadUrl`;
    const itemMetaResponse = await graphFetch(itemUrl, {}, this.authService);

    if (itemMetaResponse.status === 404) {
      throw new SyncError({
        code: 'REMOTE_NOT_FOUND',
        message: `Item ${item.name} vanished on remote OneDrive`,
        retriable: false
      });
    }

    if (itemMetaResponse.status === 403) {
      throw new SyncError({
        code: 'FORBIDDEN',
        message: `Permission denied downloading item ${item.name}`,
        retriable: false
      });
    }

    if (!itemMetaResponse.ok) {
      throw new SyncError({
        code: 'SERVER_5XX',
        message: `Failed to fetch download URL: HTTP ${itemMetaResponse.status}`,
        retriable: true
      });
    }

    const itemMetaData = await itemMetaResponse.json();
    const downloadUrl = itemMetaData['@microsoft.graph.downloadUrl'] as string | undefined;

    const downloadHeaders: Record<string, string> = {};
    if (startByte > 0) {
      downloadHeaders['Range'] = `bytes=${startByte}-`;
    }

    let downloadResponse: Response;
    if (downloadUrl) {
      // Direct pre-signed download WITHOUT authorization header
      downloadResponse = await graphFetch(
        downloadUrl,
        {
          headers: downloadHeaders,
          skipAuth: true,
          signal
        },
        this.authService
      );
    } else {
      // Fallback with auth token
      downloadResponse = await graphFetch(
        `${config.graphBaseUrl}/me/drive/items/${item.id}/content`,
        {
          headers: downloadHeaders,
          signal
        },
        this.authService
      );
    }

    if (downloadResponse.status === 401 || downloadResponse.status === 403) {
      throw new SyncError({
        code: 'DOWNLOAD_URL_EXPIRED',
        message: 'Download URL expired or invalid',
        retriable: true
      });
    }

    if (!downloadResponse.ok && downloadResponse.status !== 206) {
      throw new SyncError({
        code: 'SERVER_5XX',
        message: `Download failed with HTTP ${downloadResponse.status}`,
        retriable: true
      });
    }

    const resumed = downloadResponse.status === 206;
    if (!downloadResponse.body) {
      throw new Error('Empty response body received for download');
    }

    const nodeStream = Readable.fromWeb(
      downloadResponse.body as import('stream/web').ReadableStream
    );

    return {
      stream: nodeStream,
      resumed,
      freshDownloadUrl: downloadUrl
    };
  }
}
