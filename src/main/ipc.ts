import { ipcMain, dialog, shell, type BrowserWindow } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { z } from 'zod';
import { IPC_CHANNELS } from '../shared/ipcChannels';
import { AuthService } from './auth/authService';
import { SyncEngine } from './sync/syncEngine';
import { GraphDrive } from './onedrive/graphDrive';
import { MockDrive } from './onedrive/mockDrive';
import { validateDestination, verifyMounted } from './fs/volume';
import { settingsStore } from './settingsStore';
import { config } from './config';
import { logger, getLogFilePath } from './logger';
import type { RemoteDrive } from './onedrive/remoteDrive';
import type {
  SyncState,
  SyncProgress,
  SyncLogEntry,
  DriveStatus,
  AccountInfo,
  DriveQuota,
} from '../shared/types';

let activeMainWindow: BrowserWindow | null = null;
let services: {
  authService: AuthService;
  syncEngine: SyncEngine;
  remoteDrive: RemoteDrive;
} | null = null;
let statusInterval: NodeJS.Timeout | null = null;

function safeHandle(channel: string, handler: Parameters<typeof ipcMain.handle>[1]): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, handler);
}

export function setupIpcHandlers(mainWindow: BrowserWindow): {
  authService: AuthService;
  syncEngine: SyncEngine;
  remoteDrive: RemoteDrive;
} {
  activeMainWindow = mainWindow;

  if (services) {
    return services;
  }

  const authService = new AuthService();
  let remoteDrive: RemoteDrive;

  if (config.useMockDrive) {
    logger.info('Using MockDrive (MAIN_VITE_USE_MOCK_DRIVE=true)');
    const mock = new MockDrive();
    mock.addFolder('mock_folder', 'root', 'Sample Documents');
    mock.addFile('mock_file_1', 'mock_folder', 'GettingStarted.pdf', 'Sample OneSync Document');
    remoteDrive = mock;
  } else {
    remoteDrive = new GraphDrive(authService);
  }

  const syncEngine = new SyncEngine(remoteDrive, {
    onStateChange: (state: SyncState) => {
      if (activeMainWindow && !activeMainWindow.isDestroyed()) {
        activeMainWindow.webContents.send(IPC_CHANNELS.EVENT_SYNC_STATE, state);
      }
    },
    onProgress: (progress: SyncProgress) => {
      if (activeMainWindow && !activeMainWindow.isDestroyed()) {
        activeMainWindow.webContents.send(IPC_CHANNELS.EVENT_SYNC_PROGRESS, progress);
      }
    },
    onLog: (entry: SyncLogEntry) => {
      if (activeMainWindow && !activeMainWindow.isDestroyed()) {
        activeMainWindow.webContents.send(IPC_CHANNELS.EVENT_SYNC_LOG, entry);
      }
    },
    onDriveStatus: (status: DriveStatus) => {
      if (activeMainWindow && !activeMainWindow.isDestroyed()) {
        activeMainWindow.webContents.send(IPC_CHANNELS.EVENT_DRIVE_STATUS, status);
      }
    },
  });

  // Restore saved destination and account
  const savedSettings = settingsStore.getSettings();
  if (savedSettings.destinationPath) {
    syncEngine.setDestination(savedSettings.destinationPath);
  }
  if (savedSettings.sourceFolder) {
    syncEngine.setSourceFolder(savedSettings.sourceFolder);
  }

  // Monitor drive mount status every 3 seconds
  if (statusInterval) {
    clearInterval(statusInterval);
  }
  statusInterval = setInterval(() => {
    const currentDest = settingsStore.getSettings().destinationPath;
    if (currentDest && activeMainWindow && !activeMainWindow.isDestroyed()) {
      const isMounted = verifyMounted(currentDest);
      activeMainWindow.webContents.send(IPC_CHANNELS.EVENT_DRIVE_STATUS, {
        connected: isMounted,
        path: currentDest,
      });
    }
  }, 3000);

  // --------------------------------------------------------------------------
  // AUTH IPC
  // --------------------------------------------------------------------------
  safeHandle(IPC_CHANNELS.AUTH_GET_STATUS, async () => {
    let account: AccountInfo | null = null;
    let quota: DriveQuota | null = null;

    try {
      if (config.useMockDrive) {
        const savedAccountId = settingsStore.getSettings().accountId;
        if (savedAccountId) {
          account = await remoteDrive.getAccount();
          syncEngine.setAccount(account);
          try {
            quota = await remoteDrive.getQuota();
          } catch {
            // offline
          }
        }
      } else {
        account = await authService.getAccount();
        if (account) {
          syncEngine.setAccount(account);
          try {
            quota = await remoteDrive.getQuota();
          } catch {
            // Quota fetch can fail if offline
          }
        }
      }
    } catch {
      account = null;
    }

    return {
      signedIn: account !== null,
      account,
      quota,
    };
  });

  safeHandle(IPC_CHANNELS.AUTH_SIGN_IN, async () => {
    try {
      if (config.useMockDrive) {
        logger.info('MockDrive enabled: signing in with mock account');
        const account = await remoteDrive.getAccount();
        syncEngine.setAccount(account);
        settingsStore.setAccountId(account.id);
        return { success: true, account };
      }

      const account = await authService.signInInteractive();
      syncEngine.setAccount(account);
      settingsStore.setAccountId(account.id);
      return { success: true, account };
    } catch (err: unknown) {
      logger.error('Sign-in failed:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });

  safeHandle(IPC_CHANNELS.AUTH_SIGN_OUT, async () => {
    try {
      if (!config.useMockDrive) {
        await authService.signOut();
      }
      syncEngine.setAccount(null);
      settingsStore.setAccountId(null);
      return { success: true };
    } catch (err) {
      logger.error('Sign-out failed:', err);
      return { success: false };
    }
  });

  // --------------------------------------------------------------------------
  // DESTINATION IPC
  // --------------------------------------------------------------------------
  safeHandle(IPC_CHANNELS.DEST_PICK_FOLDER, async () => {
    const defaultPath = existsSync('/Volumes') ? '/Volumes' : undefined;
    const parentWin =
      activeMainWindow && !activeMainWindow.isDestroyed() ? activeMainWindow : undefined;
    const result = await dialog.showOpenDialog(parentWin!, {
      title: 'Select Folder on External Drive',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0] ?? null;
  });

  safeHandle(IPC_CHANNELS.DEST_VALIDATE, async (_event, folderPath: unknown) => {
    const parsed = z.string().safeParse(folderPath);
    if (!parsed.success) {
      throw new Error('Invalid folder path');
    }

    const currentAccount = await authService.getAccount();
    const validation = await validateDestination(parsed.data, currentAccount?.id);
    if (validation.isValid) {
      settingsStore.setDestination(parsed.data);
      syncEngine.setDestination(parsed.data);
    }
    return validation;
  });

  safeHandle(IPC_CHANNELS.DEST_GET_CURRENT, async () => {
    return settingsStore.getSettings().destinationPath;
  });

  safeHandle(IPC_CHANNELS.DEST_CLEAR, async () => {
    settingsStore.setDestination(null);
    syncEngine.setDestination(null);
  });

  // --------------------------------------------------------------------------
  // SYNC CONTROLS IPC
  // --------------------------------------------------------------------------
  safeHandle(IPC_CHANNELS.SYNC_START, async (_event, rawOptions?: unknown) => {
    const parsed = z.object({ force: z.boolean().optional() }).optional().safeParse(rawOptions);
    const options = parsed.success ? parsed.data : {};
    return syncEngine.startSync(options);
  });

  safeHandle(IPC_CHANNELS.SYNC_PAUSE, async () => {
    syncEngine.pauseSync();
  });

  safeHandle(IPC_CHANNELS.SYNC_RESUME, async () => {
    syncEngine.resumeSync();
  });

  safeHandle(IPC_CHANNELS.SYNC_CANCEL, async () => {
    syncEngine.cancelSync();
  });

  safeHandle(IPC_CHANNELS.SYNC_CONFIRM_MASS_MOVE, async (_event, allow: unknown) => {
    const parsed = z.boolean().safeParse(allow);
    syncEngine.confirmMassMove(parsed.success ? parsed.data : false);
  });

  safeHandle(IPC_CHANNELS.SYNC_RETRY_FAILED, async () => {
    return syncEngine.startSync({ force: true });
  });

  safeHandle(IPC_CHANNELS.SYNC_VERIFY_INTEGRITY, async () => {
    return syncEngine.startSync({ force: true });
  });

  // --------------------------------------------------------------------------
  // DATA QUERIES IPC
  // --------------------------------------------------------------------------
  safeHandle(IPC_CHANNELS.DATA_GET_FAILED, async () => {
    try {
      const { itemsRepo } = syncEngine.getDb();
      return itemsRepo.getFailedItems();
    } catch {
      return [];
    }
  });

  safeHandle(IPC_CHANNELS.DATA_GET_RESTORED, async () => {
    try {
      const { restoredLogRepo } = syncEngine.getDb();
      return restoredLogRepo.getRecent(100);
    } catch {
      return [];
    }
  });

  safeHandle(IPC_CHANNELS.DATA_GET_HISTORY, async () => {
    try {
      const { syncRunsRepo } = syncEngine.getDb();
      return syncRunsRepo.getHistory(20);
    } catch {
      return [];
    }
  });

  safeHandle(IPC_CHANNELS.DATA_CLEAR_DB, async () => {
    return syncEngine.clearDatabase();
  });

  // --------------------------------------------------------------------------
  // SOURCE FOLDER IPC
  // --------------------------------------------------------------------------
  safeHandle(IPC_CHANNELS.SOURCE_GET, async () => {
    return settingsStore.getSourceFolder();
  });

  safeHandle(IPC_CHANNELS.SOURCE_SET, async (_event, folderPath: unknown) => {
    const parsed = z.string().nullable().safeParse(folderPath);
    if (!parsed.success) {
      throw new Error('Invalid source folder path');
    }
    settingsStore.setSourceFolder(parsed.data);
    syncEngine.setSourceFolder(parsed.data);
    return { success: true };
  });

  safeHandle(IPC_CHANNELS.SOURCE_LIST_FOLDERS, async () => {
    try {
      if (remoteDrive.listRootFolders) {
        return await remoteDrive.listRootFolders();
      }
      return [];
    } catch (err) {
      logger.error('Failed to list root folders:', err);
      return [];
    }
  });

  // --------------------------------------------------------------------------
  // SYSTEM IPC
  // --------------------------------------------------------------------------
  safeHandle(
    IPC_CHANNELS.SYSTEM_REVEAL_IN_FINDER,
    async (_event, relPath: unknown, folderType?: unknown) => {
      const p = z.string().safeParse(relPath);
      const dest = settingsStore.getSettings().destinationPath;
      if (p.success && dest) {
        const sub = folderType === 'restored' ? 'restored' : 'onedrive';
        const full = join(dest, sub, p.data);
        if (existsSync(full)) {
          shell.showItemInFolder(full);
        } else {
          shell.openPath(join(dest, sub));
        }
      }
    },
  );

  safeHandle(IPC_CHANNELS.SYSTEM_OPEN_LOGS, async () => {
    const logPath = getLogFilePath();
    if (existsSync(logPath)) {
      shell.showItemInFolder(logPath);
    } else {
      shell.openPath(join(logPath, '..'));
    }
  });

  safeHandle(IPC_CHANNELS.SYSTEM_OPEN_AUTHOR_SITE, async () => {
    await shell.openExternal('https://sibansal.dev/');
  });

  safeHandle(IPC_CHANNELS.SYSTEM_OPEN_ABOUT, async () => {
    if (activeMainWindow && !activeMainWindow.isDestroyed()) {
      if (activeMainWindow.isMinimized()) activeMainWindow.restore();
      activeMainWindow.focus();
      activeMainWindow.webContents.send('app:openAbout');
    }
  });

  services = { authService, syncEngine, remoteDrive };
  return services;
}
