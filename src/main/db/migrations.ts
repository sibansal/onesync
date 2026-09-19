import type Database from 'better-sqlite3';

export const CURRENT_SCHEMA_VERSION = 1;

export function applyMigrations(db: Database.Database): void {
  // Ensure meta table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    { value: string } | undefined;

  const currentVersion = versionRow ? parseInt(versionRow.value, 10) : 0;

  if (currentVersion < 1) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS items (
          id TEXT PRIMARY KEY,
          parent_id TEXT,
          name TEXT NOT NULL,
          is_folder INTEGER NOT NULL DEFAULT 0,
          size INTEGER NOT NULL DEFAULT 0,
          fingerprint TEXT,
          hash_type TEXT,
          remote_modified TEXT,
          seen_run INTEGER,
          local_path TEXT,
          local_size INTEGER,
          local_mtime_ms INTEGER,
          synced_fingerprint TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          error_code TEXT,
          error_message TEXT,
          retry_count INTEGER NOT NULL DEFAULT 0,
          next_retry_at INTEGER,
          synced_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id);
        CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);

        CREATE TABLE IF NOT EXISTS restored_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          original_path TEXT NOT NULL,
          restored_path TEXT NOT NULL,
          reason TEXT NOT NULL,
          moved_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          status TEXT NOT NULL,
          downloaded INTEGER DEFAULT 0,
          skipped INTEGER DEFAULT 0,
          restored INTEGER DEFAULT 0,
          failed INTEGER DEFAULT 0,
          bytes INTEGER DEFAULT 0
        );

        INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1');
      `);
    })();
  }
}
