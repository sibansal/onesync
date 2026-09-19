import type Database from 'better-sqlite3';
import type { RestoredItem, SyncRunHistory } from '../../shared/types';

export class RestoredLogRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public log(
    originalPath: string,
    restoredPath: string,
    reason: 'not_on_onedrive' | 'local_modified' | 'untracked_conflict' | 'type_conflict',
    movedAt = Date.now()
  ): void {
    this.db
      .prepare(`
        INSERT INTO restored_log (original_path, restored_path, reason, moved_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(originalPath, restoredPath, reason, movedAt);
  }

  public getRecent(limit = 100): RestoredItem[] {
    const rows = this.db
      .prepare('SELECT * FROM restored_log ORDER BY moved_at DESC LIMIT ?')
      .all(limit) as Array<{
      id: number;
      original_path: string;
      restored_path: string;
      reason: 'not_on_onedrive' | 'local_modified' | 'untracked_conflict' | 'type_conflict';
      moved_at: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      originalPath: r.original_path,
      restoredPath: r.restored_path,
      reason: r.reason,
      movedAt: r.moved_at
    }));
  }
}

export class SyncRunsRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public startRun(): number {
    const result = this.db
      .prepare(`
        INSERT INTO sync_runs (started_at, status)
        VALUES (?, 'running')
      `)
      .run(Date.now());
    return Number(result.lastInsertRowid);
  }

  public finishRun(
    id: number,
    stats: {
      status: 'completed' | 'paused' | 'cancelled' | 'failed';
      downloaded: number;
      skipped: number;
      restored: number;
      failed: number;
      bytes: number;
    }
  ): void {
    this.db
      .prepare(`
        UPDATE sync_runs SET
          finished_at = @finishedAt,
          status = @status,
          downloaded = @downloaded,
          skipped = @skipped,
          restored = @restored,
          failed = @failed,
          bytes = @bytes
        WHERE id = @id
      `)
      .run({
        id,
        finishedAt: Date.now(),
        status: stats.status,
        downloaded: stats.downloaded,
        skipped: stats.skipped,
        restored: stats.restored,
        failed: stats.failed,
        bytes: stats.bytes
      });
  }

  public getHistory(limit = 20): SyncRunHistory[] {
    const rows = this.db
      .prepare('SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT ?')
      .all(limit) as Array<{
      id: number;
      started_at: number;
      finished_at: number | null;
      status: 'running' | 'completed' | 'paused' | 'cancelled' | 'failed';
      downloaded: number;
      skipped: number;
      restored: number;
      failed: number;
      bytes: number;
    }>;

    return rows.map((r) => ({
      id: r.id,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      downloaded: r.downloaded,
      skipped: r.skipped,
      restored: r.restored,
      failed: r.failed,
      bytes: r.bytes
    }));
  }
}
