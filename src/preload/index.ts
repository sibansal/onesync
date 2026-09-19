import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import type {
  OneSyncAPI,
  AccountInfo,
  DriveQuota,
  DestinationValidation,
  SyncState,
  SyncProgress,
  SyncLogEntry,
  DriveStatus,
  FailedItem,
  RestoredItem,
  SyncRunHistory,
  RemoteFolder,
} from '../shared/types';

const api: OneSyncAPI = {
  getStatus: (): Promise<{
    signedIn: boolean;
    account: AccountInfo | null;
    quota: DriveQuota | null;
  }> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_GET_STATUS),

  signIn: (): Promise<{ success: boolean; account?: AccountInfo; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_SIGN_IN),

  signOut: (): Promise<{ success: boolean }> => ipcRenderer.invoke(IPC_CHANNELS.AUTH_SIGN_OUT),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.DEST_PICK_FOLDER),

  validateDestination: (folderPath: string): Promise<DestinationValidation> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEST_VALIDATE, folderPath),

  getCurrentDestination: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.DEST_GET_CURRENT),

  clearDestination: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.DEST_CLEAR),

  startSync: (options?: { force?: boolean }): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_START, options),

  pauseSync: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SYNC_PAUSE),

  resumeSync: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SYNC_RESUME),

  cancelSync: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SYNC_CANCEL),

  getSyncState: (): Promise<SyncState> => ipcRenderer.invoke(IPC_CHANNELS.SYNC_GET_STATE),

  confirmMassMove: (allow: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SYNC_CONFIRM_MASS_MOVE, allow),

  retryFailed: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SYNC_RETRY_FAILED),

  verifyIntegrity: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SYNC_VERIFY_INTEGRITY),

  getFailed: (): Promise<FailedItem[]> => ipcRenderer.invoke(IPC_CHANNELS.DATA_GET_FAILED),

  getRestored: (): Promise<RestoredItem[]> => ipcRenderer.invoke(IPC_CHANNELS.DATA_GET_RESTORED),

  getHistory: (): Promise<SyncRunHistory[]> => ipcRenderer.invoke(IPC_CHANNELS.DATA_GET_HISTORY),

  clearDatabase: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC_CHANNELS.DATA_CLEAR_DB),

  getSourceFolder: (): Promise<string | null> => ipcRenderer.invoke(IPC_CHANNELS.SOURCE_GET),

  setSourceFolder: (folderPath: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCE_SET, folderPath),

  listSourceFolders: (): Promise<RemoteFolder[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.SOURCE_LIST_FOLDERS),

  revealInFinder: (relPath: string, folderType?: 'onedrive' | 'restored'): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_REVEAL_IN_FINDER, relPath, folderType),

  openLogs: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_LOGS),

  openAuthorSite: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_AUTHOR_SITE),

  openAbout: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.SYSTEM_OPEN_ABOUT),

  onSyncState: (callback: (state: SyncState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SyncState): void => callback(state);
    ipcRenderer.on(IPC_CHANNELS.EVENT_SYNC_STATE, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.EVENT_SYNC_STATE, handler);
    };
  },

  onSyncProgress: (callback: (progress: SyncProgress) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: SyncProgress): void =>
      callback(progress);
    ipcRenderer.on(IPC_CHANNELS.EVENT_SYNC_PROGRESS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.EVENT_SYNC_PROGRESS, handler);
    };
  },

  onSyncLog: (callback: (entry: SyncLogEntry) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, entry: SyncLogEntry): void =>
      callback(entry);
    ipcRenderer.on(IPC_CHANNELS.EVENT_SYNC_LOG, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.EVENT_SYNC_LOG, handler);
    };
  },

  onDriveStatus: (callback: (status: DriveStatus) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: DriveStatus): void =>
      callback(status);
    ipcRenderer.on(IPC_CHANNELS.EVENT_DRIVE_STATUS, handler);
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.EVENT_DRIVE_STATUS, handler);
    };
  },

  onOpenAbout: (callback: () => void): (() => void) => {
    const handler = (): void => callback();
    ipcRenderer.on('app:openAbout', handler);
    return () => {
      ipcRenderer.removeListener('app:openAbout', handler);
    };
  },
};

contextBridge.exposeInMainWorld('onesync', api);
