import { Readable } from 'stream';
import { createHash } from 'crypto';
import type { RemoteDrive } from './remoteDrive';
import type { RemoteItem, AccountInfo, DriveQuota } from '../../shared/types';
import { SyncError } from '../utils/errors';
import { quickXorHash } from '../utils/quickXorHash';

export interface MockItemData {
  item: RemoteItem;
  content: Buffer;
}

export class MockDrive implements RemoteDrive {
  private items = new Map<string, MockItemData>();
  private failureQueue: Array<{
    type: '429' | '401' | 'network' | '403' | 'expired_url';
    retryAfter?: number;
    target?: 'list' | 'download';
  }> = [];
  private ignoreRange = false;
  private currentDeltaVersion = 1;

  constructor() {
    this.addFolder('root', null, 'OneDrive Root');
  }

  public setIgnoreRange(ignore: boolean): void {
    this.ignoreRange = ignore;
  }

  public simulateFailure(
    type: '429' | '401' | 'network' | '403' | 'expired_url',
    retryAfter?: number,
    target?: 'list' | 'download'
  ): void {
    const effectiveTarget = target ?? (type === '403' || type === 'expired_url' ? 'download' : undefined);
    this.failureQueue.push({ type, retryAfter, target: effectiveTarget });
  }

  public addFolder(id: string, parentId: string | null, name: string): void {
    this.items.set(id, {
      item: {
        id,
        parentId,
        name,
        isFolder: true,
        size: 0,
        fingerprint: null,
        hashType: null,
        remoteModified: new Date().toISOString()
      },
      content: Buffer.alloc(0)
    });
    this.currentDeltaVersion++;
  }

  public addFile(
    id: string,
    parentId: string | null,
    name: string,
    content: Buffer | string,
    options?: { modified?: string; hashType?: 'sha256' | 'sha1' | 'quickXor' }
  ): void {
    const buf = typeof content === 'string' ? Buffer.from(content, 'utf-8') : content;
    const hashType = options?.hashType ?? 'sha256';

    let hashVal = '';
    if (hashType === 'sha256') {
      hashVal = createHash('sha256').update(buf).digest('hex');
    } else if (hashType === 'sha1') {
      hashVal = createHash('sha1').update(buf).digest('hex');
    } else {
      hashVal = quickXorHash(buf);
    }

    this.items.set(id, {
      item: {
        id,
        parentId,
        name,
        isFolder: false,
        size: buf.length,
        fingerprint: hashVal,
        hashType,
        remoteModified: options?.modified ?? new Date().toISOString()
      },
      content: buf
    });
    this.currentDeltaVersion++;
  }

  public deleteItem(id: string): void {
    const existing = this.items.get(id);
    if (existing) {
      existing.item.isDeleted = true;
      this.currentDeltaVersion++;
    }
  }

  public renameItem(id: string, newName: string, newParentId?: string): void {
    const existing = this.items.get(id);
    if (existing) {
      existing.item.name = newName;
      if (newParentId !== undefined) {
        existing.item.parentId = newParentId;
      }
      this.currentDeltaVersion++;
    }
  }

  public modifyFile(id: string, newContent: Buffer | string): void {
    const existing = this.items.get(id);
    if (existing) {
      const buf = typeof newContent === 'string' ? Buffer.from(newContent, 'utf-8') : newContent;
      existing.content = buf;
      existing.item.size = buf.length;
      if (existing.item.hashType === 'sha256') {
        existing.item.fingerprint = createHash('sha256').update(buf).digest('hex');
      } else if (existing.item.hashType === 'sha1') {
        existing.item.fingerprint = createHash('sha1').update(buf).digest('hex');
      } else {
        existing.item.fingerprint = quickXorHash(buf);
      }
      existing.item.remoteModified = new Date().toISOString();
      this.currentDeltaVersion++;
    }
  }

  public async getAccount(): Promise<AccountInfo> {
    return {
      id: 'mock_user_account_id',
      name: 'Mock User',
      email: 'mock.user@example.com'
    };
  }

  public async getQuota(): Promise<DriveQuota> {
    let totalUsed = 0;
    for (const entry of this.items.values()) {
      if (!entry.item.isDeleted) {
        totalUsed += entry.item.size;
      }
    }
    return {
      used: totalUsed,
      total: 100 * 1024 * 1024 * 1024 // 100 GB
    };
  }

  public async listChanges(
    deltaLink: string | null,
    onPage: (items: RemoteItem[]) => void
  ): Promise<{ deltaLink: string; isFullListing: boolean }> {
    // Check failure queue for list-targeted failures
    const listFailureIdx = this.failureQueue.findIndex(
      (f) => f.target === 'list' || (!f.target && f.type !== '403' && f.type !== 'expired_url')
    );
    if (listFailureIdx !== -1) {
      const [failure] = this.failureQueue.splice(listFailureIdx, 1);
      if (failure) {
        if (failure.type === '429') {
          throw new SyncError({
            code: 'THROTTLED',
            message: 'Mock Rate limited (HTTP 429)',
            retriable: true,
            retryAfterMs: (failure.retryAfter ?? 1) * 1000
          });
        }
        if (failure.type === 'network') {
          throw new SyncError({
            code: 'NETWORK',
            message: 'Mock Network connection lost',
            retriable: true
          });
        }
        if (failure.type === '401') {
          throw new SyncError({
            code: 'AUTH_EXPIRED',
            message: 'Mock Auth token expired',
            retriable: true
          });
        }
      }
    }

    const allItems = Array.from(this.items.values()).map((v) => ({ ...v.item }));
    onPage(allItems);

    return {
      deltaLink: `mock_delta_v${this.currentDeltaVersion}`,
      isFullListing: !deltaLink
    };
  }

  public async openDownload(
    item: RemoteItem,
    startByte = 0,
    signal?: AbortSignal
  ): Promise<{ stream: Readable; resumed: boolean; freshDownloadUrl?: string }> {
    // Check failure queue for download-targeted failures
    const dlFailureIdx = this.failureQueue.findIndex(
      (f) => f.target === 'download' || !f.target
    );
    if (dlFailureIdx !== -1) {
      const [failure] = this.failureQueue.splice(dlFailureIdx, 1);
      if (failure) {
        if (failure.type === '429') {
          throw new SyncError({
            code: 'THROTTLED',
            message: 'Mock throttled download',
            retriable: true,
            retryAfterMs: (failure.retryAfter ?? 1) * 1000
          });
        }
        if (failure.type === 'expired_url') {
          throw new SyncError({
            code: 'DOWNLOAD_URL_EXPIRED',
            message: 'Mock download URL expired',
            retriable: true
          });
        }
        if (failure.type === '403') {
          throw new SyncError({
            code: 'FORBIDDEN',
            message: 'Mock download 403 Forbidden',
            retriable: false
          });
        }
        if (failure.type === 'network') {
          throw new SyncError({
            code: 'NETWORK',
            message: 'Mock network interruption during download',
            retriable: true
          });
        }
      }
    }

    const data = this.items.get(item.id);
    if (!data || data.item.isDeleted) {
      throw new SyncError({
        code: 'REMOTE_NOT_FOUND',
        message: `Mock item not found: ${item.id}`,
        retriable: false
      });
    }

    let actualStart = startByte;
    let resumed = false;

    if (startByte > 0 && !this.ignoreRange) {
      actualStart = startByte;
      resumed = true;
    } else {
      actualStart = 0;
      resumed = false;
    }

    const sliced = data.content.subarray(actualStart);

    const stream = new Readable({
      read() {
        if (signal?.aborted) {
          this.destroy(new Error('Download stream aborted'));
          return;
        }
        this.push(sliced);
        this.push(null);
      }
    });

    return {
      stream,
      resumed,
      freshDownloadUrl: `https://mock.onedrive.local/download/${item.id}`
    };
  }
}
