import type Database from 'better-sqlite3';
import type { RemoteItem, FailedItem } from '../../shared/types';

export interface DbItem {
  id: string;
  parent_id: string | null;
  name: string;
  is_folder: number;
  size: number;
  fingerprint: string | null;
  hash_type: 'sha1' | 'sha256' | 'quickXor' | null;
  remote_modified: string | null;
  seen_run: number | null;
  local_path: string | null;
  local_size: number | null;
  local_mtime_ms: number | null;
  synced_fingerprint: string | null;
  status: 'pending' | 'synced' | 'failed' | 'failed_permanent';
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  next_retry_at: number | null;
  synced_at: number | null;
}

export class ItemsRepo {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  public upsertBatch(items: RemoteItem[], seenRun: number | null = null): void {
    const insertStmt = this.db.prepare(`
      INSERT INTO items (
        id, parent_id, name, is_folder, size, fingerprint, hash_type,
        remote_modified, seen_run, status
      ) VALUES (
        @id, @parentId, @name, @isFolder, @size, @fingerprint, @hashType,
        @remoteModified, @seenRun, 'pending'
      )
      ON CONFLICT(id) DO UPDATE SET
        parent_id = excluded.parent_id,
        name = excluded.name,
        is_folder = excluded.is_folder,
        size = excluded.size,
        fingerprint = excluded.fingerprint,
        hash_type = excluded.hash_type,
        remote_modified = excluded.remote_modified,
        seen_run = COALESCE(excluded.seen_run, items.seen_run)
    `);

    const deleteStmt = this.db.prepare('DELETE FROM items WHERE id = ?');

    const transaction = this.db.transaction((batch: RemoteItem[]) => {
      for (const item of batch) {
        if (item.isDeleted) {
          deleteStmt.run(item.id);
        } else {
          insertStmt.run({
            id: item.id,
            parentId: item.parentId,
            name: item.name,
            isFolder: item.isFolder ? 1 : 0,
            size: item.size,
            fingerprint: item.fingerprint,
            hashType: item.hashType,
            remoteModified: item.remoteModified,
            seenRun,
          });
        }
      }
    });

    transaction(items);
  }

  public deleteMissingInRun(currentRun: number): void {
    this.db
      .prepare('DELETE FROM items WHERE seen_run IS NOT NULL AND seen_run < ?')
      .run(currentRun);
  }

  public getItem(id: string): DbItem | null {
    const row = this.db.prepare('SELECT * FROM items WHERE id = ?').get(id) as DbItem | undefined;
    return row ?? null;
  }

  public getAllItems(): DbItem[] {
    return this.db.prepare('SELECT * FROM items').all() as DbItem[];
  }

  public getAllFiles(): DbItem[] {
    return this.db.prepare('SELECT * FROM items WHERE is_folder = 0').all() as DbItem[];
  }

  public getCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM items WHERE is_folder = 0')
      .get() as {
      count: number;
    };
    return row.count;
  }

  public updateLocalSynced(
    id: string,
    update: {
      localPath: string;
      localSize: number;
      localMtimeMs: number;
      syncedFingerprint: string | null;
      syncedAt: number;
    },
  ): void {
    this.db
      .prepare(
        `
        UPDATE items SET
          local_path = @localPath,
          local_size = @localSize,
          local_mtime_ms = @localMtimeMs,
          synced_fingerprint = @syncedFingerprint,
          synced_at = @syncedAt,
          status = 'synced',
          error_code = NULL,
          error_message = NULL,
          retry_count = 0,
          next_retry_at = NULL
        WHERE id = @id
      `,
      )
      .run({
        id,
        localPath: update.localPath,
        localSize: update.localSize,
        localMtimeMs: update.localMtimeMs,
        syncedFingerprint: update.syncedFingerprint,
        syncedAt: update.syncedAt,
      });
  }

  public updateLocalRenamed(id: string, newLocalPath: string): void {
    this.db.prepare('UPDATE items SET local_path = ? WHERE id = ?').run(newLocalPath, id);
  }

  public markFailed(
    id: string,
    options: {
      errorCode: string;
      errorMessage: string;
      nextRetryAt: number;
    },
  ): void {
    this.db
      .prepare(
        `
        UPDATE items SET
          status = 'failed',
          error_code = @errorCode,
          error_message = @errorMessage,
          retry_count = retry_count + 1,
          next_retry_at = @nextRetryAt
        WHERE id = @id
      `,
      )
      .run({
        id,
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
        nextRetryAt: options.nextRetryAt,
      });
  }

  public markFailedPermanent(
    id: string,
    options: {
      errorCode: string;
      errorMessage: string;
    },
  ): void {
    this.db
      .prepare(
        `
        UPDATE items SET
          status = 'failed_permanent',
          error_code = @errorCode,
          error_message = @errorMessage
        WHERE id = @id
      `,
      )
      .run({
        id,
        errorCode: options.errorCode,
        errorMessage: options.errorMessage,
      });
  }

  public resetFailedRetries(): void {
    this.db
      .prepare(
        `
        UPDATE items SET
          status = 'pending',
          next_retry_at = NULL
        WHERE status = 'failed'
      `,
      )
      .run();
  }

  public getFailedItems(): FailedItem[] {
    const rows = this.db
      .prepare("SELECT * FROM items WHERE status IN ('failed', 'failed_permanent')")
      .all() as DbItem[];

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      localPath: r.local_path,
      errorCode: r.error_code,
      errorMessage: r.error_message,
      retryCount: r.retry_count,
      nextRetryAt: r.next_retry_at,
    }));
  }

  public deleteItem(id: string): void {
    this.db.prepare('DELETE FROM items WHERE id = ?').run(id);
  }
}
