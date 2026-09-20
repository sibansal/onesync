import { app, BrowserWindow, shell, dialog, Menu } from 'electron';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { config } from './config';
import { logger } from './logger';

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception in main process:', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection in main process:', reason);
});

// Set application name early so macOS menus, dock, and process reflect OneSync
app.setName('OneSync');
app.name = 'OneSync';

let mainWindow: BrowserWindow | null = null;

const ALLOWED_EXTERNAL_HOSTS = new Set(['sibansal.dev', 'login.microsoftonline.com']);

function isAllowedUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'https:' && ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

import { setupIpcHandlers } from './ipc';
import { cleanupSleepBlocker } from './sleepBlocker';
import type { AuthService } from './auth/authService';

let syncEngineRef: { getState: () => { isRunning: boolean } } | null = null;
let authServiceRef: AuthService | null = null;

export function resolveAppIcon(): string | undefined {
  if (config.customIconPath && existsSync(config.customIconPath)) {
    return resolve(config.customIconPath);
  }
  const possiblePaths = [
    join(__dirname, '../../build/icon.png'),
    join(__dirname, '../../build/icon.icns'),
    join(process.resourcesPath, 'build/icon.png'),
    join(process.resourcesPath, 'icon.png'),
    join(process.resourcesPath, 'build/icon.icns'),
    join(process.resourcesPath, 'icon.icns'),
    join(app.getAppPath(), 'build/icon.png'),
  ];
  for (const p of possiblePaths) {
    if (existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

function createApplicationMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'OneSync',
            submenu: [
              {
                label: 'About OneSync',
                click: () => {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    if (mainWindow.isMinimized()) mainWindow.restore();
                    mainWindow.focus();
                    mainWindow.webContents.send('app:openAbout');
                  }
                },
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Hide OneSync' },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Quit OneSync' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [isMac ? { role: 'close' as const } : { role: 'quit' as const }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const },
            ]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      role: 'help' as const,
      submenu: [
        {
          label: 'OneSync Website',
          click: async () => {
            await shell.openExternal('https://sibansal.dev/');
          },
        },
        {
          label: 'About OneSync',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              if (mainWindow.isMinimized()) mainWindow.restore();
              mainWindow.focus();
              mainWindow.webContents.send('app:openAbout');
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  const iconPath = resolveAppIcon();

  mainWindow = new BrowserWindow({
    title: 'OneSync',
    width: 960,
    height: 840,
    minWidth: 800,
    minHeight: 800,
    show: false,
    autoHideMenuBar: false,
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const { syncEngine, authService } = setupIpcHandlers(mainWindow);
  syncEngineRef = syncEngine;
  authServiceRef = authService;

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('close', (e) => {
    if (syncEngineRef?.getState().isRunning) {
      const choice = dialog.showMessageBoxSync(mainWindow!, {
        type: 'warning',
        buttons: ['Keep Syncing', 'Quit Anyway'],
        defaultId: 0,
        cancelId: 0,
        title: 'Sync in Progress',
        message:
          'A sync is currently in progress. Quitting now will cleanly pause downloads. Are you sure you want to quit?',
      });

      if (choice === 0) {
        e.preventDefault();
        return;
      }
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedUrl(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // HMR or production file loading
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Register custom protocol schemes for OAuth redirects
app.setAsDefaultProtocolClient('onesync');
app.setAsDefaultProtocolClient('dev.sibansal.onesync');
if (config.msClientId && config.msClientId !== '00000000-0000-0000-0000-000000000000') {
  app.setAsDefaultProtocolClient(`msal${config.msClientId}`);
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (authServiceRef) {
    authServiceRef.handleCustomSchemeUrl(url);
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const iconPath = resolveAppIcon();
    if (process.platform === 'darwin') {
      if (app.dock && iconPath) {
        try {
          app.dock.setIcon(iconPath);
        } catch {
          // ignore if not supported in running environment
        }
      }

      app.setAboutPanelOptions({
        applicationName: 'OneSync',
        applicationVersion: '1.0.0',
        version: '1.0.0',
        copyright: 'Copyright © sibansal.dev',
        credits:
          'Built with ❤️ by sibansal.dev (https://sibansal.dev/)\nA high-performance macOS mirror for OneDrive.',
        authors: ['sibansal.dev'],
        website: 'https://sibansal.dev/',
        iconPath: iconPath,
      });
    }

    createApplicationMenu();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    cleanupSleepBlocker();
  });
}
