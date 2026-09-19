import Database from 'better-sqlite3';
import { existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import { applyMigrations } from './migrations';
import { logger } from '../logger';

export class AppDatabase {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private readonly baseFolder: string;

  constructor(baseFolder: string) {
    this.baseFolder = baseFolder;
    this.dbPath = join(baseFolder, '.onesync', 'state.db');
  }

  public open(): Database.Database {
    if (this.db) {
      return this.db;
    }

    const onesyncDir = join(this.baseFolder, '.onesync');
    if (!existsSync(onesyncDir)) {
      mkdirSync(onesyncDir, { recursive: true });
    }

    const tmpDir = join(onesyncDir, 'tmp');
    if (!existsSync(tmpDir)) {
      mkdirSync(tmpDir, { recursive: true });
    }

    let sqliteInstance: Database.Database;

    const createAndVerifyDb = (): Database.Database => {
      const inst = new Database(this.dbPath, { timeout: 5000 });
      try {
        inst.pragma('busy_timeout = 5000');
        inst.pragma('journal_mode = DELETE');
        inst.pragma('synchronous = NORMAL');

        const integrity = inst.pragma('integrity_check') as Array<{ integrity_check: string }>;
        const isOk = integrity.length > 0 && integrity[0]?.integrity_check === 'ok';

        if (!isOk) {
          throw new Error('state.db failed integrity check');
        }
        return inst;
      } catch (err) {
        try {
          inst.close();
        } catch {
          // ignore
        }
        throw err;
      }
    };

    try {
      sqliteInstance = createAndVerifyDb();
    } catch (err) {
      logger.warn(
        'state.db corrupted or failed integrity check. Moving aside and creating fresh state:',
        err,
      );
      try {
        if (existsSync(this.dbPath)) {
          const corruptPath = join(onesyncDir, `state.db.corrupt-${Date.now()}`);
          renameSync(this.dbPath, corruptPath);
        }
        const walPath = `${this.dbPath}-wal`;
        const shmPath = `${this.dbPath}-shm`;
        const journalPath = `${this.dbPath}-journal`;
        if (existsSync(walPath)) unlinkSync(walPath);
        if (existsSync(shmPath)) unlinkSync(shmPath);
        if (existsSync(journalPath)) unlinkSync(journalPath);
      } catch (renameErr) {
        logger.error('Failed to move corrupted state.db aside:', renameErr);
      }

      sqliteInstance = new Database(this.dbPath, { timeout: 5000 });
      sqliteInstance.pragma('busy_timeout = 5000');
      sqliteInstance.pragma('journal_mode = DELETE');
      sqliteInstance.pragma('synchronous = NORMAL');
    }

    applyMigrations(sqliteInstance);
    this.db = sqliteInstance;
    return this.db;
  }

  public getRawDb(): Database.Database {
    if (!this.db) {
      return this.open();
    }
    return this.db;
  }

  public close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch (err) {
        logger.error('Error closing database:', err);
      } finally {
        this.db = null;
      }
    }
  }
}
