import { app } from 'electron';
import { join } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { logger } from './logger';

export interface AppSettings {
  destinationPath: string | null;
  accountId: string | null;
  sourceFolder: string | null;
}

const DEFAULT_SETTINGS: AppSettings = {
  destinationPath: null,
  accountId: null,
  sourceFolder: null,
};

class SettingsStore {
  private filePath: string;
  private settings: AppSettings;

  constructor() {
    let userDataDir = '';
    try {
      if (app && typeof app.getPath === 'function') {
        userDataDir = app.getPath('userData');
      }
    } catch {
      // test environment
    }
    if (!userDataDir) {
      userDataDir = process.env.TMPDIR || '/tmp';
    }
    this.filePath = join(userDataDir, 'settings.json');
    this.settings = this.load();
  }

  private load(): AppSettings {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
          destinationPath:
            typeof parsed.destinationPath === 'string' ? parsed.destinationPath : null,
          accountId: typeof parsed.accountId === 'string' ? parsed.accountId : null,
          sourceFolder: typeof parsed.sourceFolder === 'string' ? parsed.sourceFolder : null,
        };
      }
    } catch (err) {
      logger.error('Failed to load settings.json, resetting to defaults:', err);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private save(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (err) {
      logger.error('Failed to persist settings.json:', err);
    }
  }

  public getSettings(): Readonly<AppSettings> {
    return { ...this.settings };
  }

  public setDestination(destinationPath: string | null): void {
    this.settings.destinationPath = destinationPath;
    this.save();
  }

  public setAccountId(accountId: string | null): void {
    this.settings.accountId = accountId;
    this.save();
  }

  public setSourceFolder(sourceFolder: string | null): void {
    this.settings.sourceFolder = sourceFolder;
    this.save();
  }

  public getSourceFolder(): string | null {
    return this.settings.sourceFolder;
  }

  public clear(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.save();
  }
}

export const settingsStore = new SettingsStore();
