import type { Readable } from 'stream';
import type { RemoteItem, AccountInfo, DriveQuota } from '../../shared/types';

export interface RemoteDrive {
  getAccount(): Promise<AccountInfo>;
  getQuota(): Promise<DriveQuota>;
  listRootFolders?(): Promise<Array<{ id: string; name: string; path: string }>>;
  listChanges(
    deltaLink: string | null,
    onPage: (items: RemoteItem[]) => void,
    signal?: AbortSignal,
    checkPause?: () => Promise<void>,
    sourceFolder?: string | null,
  ): Promise<{ deltaLink: string; isFullListing: boolean }>;
  openDownload(
    item: RemoteItem,
    startByte: number,
    signal?: AbortSignal,
  ): Promise<{ stream: Readable; resumed: boolean; freshDownloadUrl?: string }>;
}
