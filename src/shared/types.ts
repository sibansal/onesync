export interface AccountInfo {
  id: string;
  name: string;
  email: string;
}

export interface DriveQuota {
  used: number;
  total: number;
}

export interface DestinationValidation {
  path: string;
  isExternal: boolean;
  isDifferentDevice: boolean;
  isWritable: boolean;
  freeSpaceBytes: number;
  fsType: string;
  existingDb: boolean;
  existingAccount: string | null;
  isValid: boolean;
  errors: string[];
}

export type SyncPhase =
  | 'idle'
  | 'preflight'
  | 'scanning'
  | 'planning'
  | 'downloading'
  | 'sweeping'
  | 'finishing'
  | 'paused'
  | 'error';

export interface ActiveDownload {
  id: string;
  name: string;
  bytesDone: number;
  totalBytes: number;
}

export interface SyncProgress {
  phase: SyncPhase;
  filesDone: number;
  totalFiles: number;
  bytesDone: number;
  totalBytes: number;
  speedBytesPerSec: number;
  jobId: string | null;
  etaSeconds: number | null;
  activeDownloads: ActiveDownload[];
  downloadedCount: number;
  upToDateCount: number;
  restoredCount: number;
  failedCount: number;
}

export interface SyncState {
  phase: SyncPhase;
  isRunning: boolean;
  isPaused: boolean;
  isCancelled?: boolean;
  isWaitingMassMove: boolean;
  pendingMovesCount: number;
  error: string | null;
  jobId: string | null;
}

export interface RemoteFolder {
  id: string;
  name: string;
  path: string;
}

export interface SyncLogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface FailedItem {
  id: string;
  name: string;
  localPath: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  retryCount: number;
  nextRetryAt: number | null;
}

export interface RestoredItem {
  id: number;
  originalPath: string;
  restoredPath: string;
  reason: 'not_on_onedrive' | 'local_modified' | 'untracked_conflict' | 'type_conflict';
  movedAt: number;
}

export interface SyncRunHistory {
  id: number;
  startedAt: number;
  finishedAt: number | null;
  status: 'running' | 'completed' | 'paused' | 'cancelled' | 'failed';
  downloaded: number;
  skipped: number;
  restored: number;
  failed: number;
  bytes: number;
}

export interface DriveStatus {
  connected: boolean;
  path: string | null;
}

export interface RemoteItem {
  id: string;
  parentId: string | null;
  name: string;
  isFolder: boolean;
  size: number;
  fingerprint: string | null;
  hashType: 'sha1' | 'sha256' | 'quickXor' | null;
  remoteModified: string | null;
  downloadUrl?: string | null;
  isDeleted?: boolean;
  package?: unknown;
  remoteItem?: unknown;
}

export interface OneSyncAPI {
  // Auth
  getStatus: () => Promise<{
    signedIn: boolean;
    account: AccountInfo | null;
    quota: DriveQuota | null;
  }>;
  signIn: () => Promise<{ success: boolean; account?: AccountInfo; error?: string }>;
  signOut: () => Promise<{ success: boolean }>;

  // Destination
  pickFolder: () => Promise<string | null>;
  validateDestination: (folderPath: string) => Promise<DestinationValidation>;
  getCurrentDestination: () => Promise<string | null>;
  clearDestination: () => Promise<void>;

  // Sync controls
  startSync: (options?: { force?: boolean }) => Promise<{ success: boolean; error?: string }>;
  pauseSync: () => Promise<void>;
  resumeSync: () => Promise<void>;
  cancelSync: () => Promise<void>;
  confirmMassMove: (allow: boolean) => Promise<void>;
  retryFailed: () => Promise<void>;
  verifyIntegrity: () => Promise<void>;

  // Data queries
  getFailed: () => Promise<FailedItem[]>;
  getRestored: () => Promise<RestoredItem[]>;
  getHistory: () => Promise<SyncRunHistory[]>;
  clearDatabase: () => Promise<{ success: boolean; error?: string }>;

  // Source folder
  getSourceFolder: () => Promise<string | null>;
  setSourceFolder: (folderPath: string | null) => Promise<void>;
  listSourceFolders: () => Promise<RemoteFolder[]>;

  // System
  revealInFinder: (relPath: string, folderType?: 'onedrive' | 'restored') => Promise<void>;
  openLogs: () => Promise<void>;
  openAuthorSite: () => Promise<void>;
  openAbout: () => Promise<void>;

  // Event Listeners
  onSyncState: (callback: (state: SyncState) => void) => () => void;
  onSyncProgress: (callback: (progress: SyncProgress) => void) => () => void;
  onSyncLog: (callback: (entry: SyncLogEntry) => void) => () => void;
  onDriveStatus: (callback: (status: DriveStatus) => void) => () => void;
  onOpenAbout: (callback: () => void) => () => void;
}
