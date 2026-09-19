import type Database from 'better-sqlite3';

export class MetaRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  }

  public set(key: string, value: string): void {
    this.db
      .prepare(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      )
      .run(key, value);
  }

  public getAccountId(): string | null {
    return this.get('account_id');
  }

  public setAccountId(id: string): void {
    this.set('account_id', id);
  }

  public getDeltaLink(): string | null {
    return this.get('delta_link');
  }

  public setDeltaLink(link: string | null): void {
    if (link === null) {
      this.db.prepare("DELETE FROM meta WHERE key = 'delta_link'").run();
    } else {
      this.set('delta_link', link);
    }
  }

  public getLastSyncAt(): number | null {
    const val = this.get('last_sync_at');
    return val ? parseInt(val, 10) : null;
  }

  public setLastSyncAt(timestamp: number): void {
    this.set('last_sync_at', String(timestamp));
  }

  public getSourceFolder(): string | null {
    return this.get('source_folder');
  }

  public setSourceFolder(folder: string | null): void {
    if (folder === null || folder === '') {
      this.db.prepare("DELETE FROM meta WHERE key = 'source_folder'").run();
    } else {
      this.set('source_folder', folder);
    }
  }
}

