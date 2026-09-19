import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { AppDatabase } from '../src/main/db/database';
import { MetaRepo } from '../src/main/db/metaRepo';
import { ItemsRepo } from '../src/main/db/itemsRepo';
import { RestoredLogRepo, SyncRunsRepo } from '../src/main/db/logRepo';

describe('Database and Repositories', () => {
  const testDir = join(__dirname, 'temp_db_test');
  let appDb: AppDatabase;

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    appDb = new AppDatabase(testDir);
  });

  afterEach(() => {
    appDb.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('initializes database and applies schema migrations', () => {
    const rawDb = appDb.open();
    const metaRepo = new MetaRepo(rawDb);
    expect(metaRepo.get('schema_version')).toBe('1');
  });

  it('stores and updates metadata', () => {
    const rawDb = appDb.open();
    const metaRepo = new MetaRepo(rawDb);

    metaRepo.setAccountId('account_123');
    expect(metaRepo.getAccountId()).toBe('account_123');

    metaRepo.setDeltaLink('https://graph.microsoft.com/delta_token');
    expect(metaRepo.getDeltaLink()).toBe('https://graph.microsoft.com/delta_token');

    metaRepo.setDeltaLink(null);
    expect(metaRepo.getDeltaLink()).toBeNull();
  });

  it('upserts and queries items in batches', () => {
    const rawDb = appDb.open();
    const itemsRepo = new ItemsRepo(rawDb);

    itemsRepo.upsertBatch([
      {
        id: 'item1',
        parentId: null,
        name: 'test.pdf',
        isFolder: false,
        size: 1024,
        fingerprint: 'fp_abc',
        hashType: 'sha256',
        remoteModified: '2026-09-19T00:00:00Z',
      },
      {
        id: 'item2',
        parentId: null,
        name: 'folder',
        isFolder: true,
        size: 0,
        fingerprint: null,
        hashType: null,
        remoteModified: '2026-09-19T00:00:00Z',
      },
    ]);

    expect(itemsRepo.getCount()).toBe(1); // 1 file
    const item1 = itemsRepo.getItem('item1');
    expect(item1?.name).toBe('test.pdf');
    expect(item1?.status).toBe('pending');

    itemsRepo.updateLocalSynced('item1', {
      localPath: 'test.pdf',
      localSize: 1024,
      localMtimeMs: 1700000000000,
      syncedFingerprint: 'fp_abc',
      syncedAt: Date.now(),
    });

    const updated = itemsRepo.getItem('item1');
    expect(updated?.status).toBe('synced');
    expect(updated?.local_path).toBe('test.pdf');
  });

  it('tracks restored logs and sync runs history', () => {
    const rawDb = appDb.open();
    const restoredRepo = new RestoredLogRepo(rawDb);
    const syncRunsRepo = new SyncRunsRepo(rawDb);

    restoredRepo.log('old.txt', 'restored/old.txt', 'not_on_onedrive');
    const recentRestored = restoredRepo.getRecent(10);
    expect(recentRestored).toHaveLength(1);
    expect(recentRestored[0]?.originalPath).toBe('old.txt');

    const runId = syncRunsRepo.startRun();
    expect(runId).toBeGreaterThan(0);

    syncRunsRepo.finishRun(runId, {
      status: 'completed',
      downloaded: 5,
      skipped: 10,
      restored: 1,
      failed: 0,
      bytes: 50000,
    });

    const history = syncRunsRepo.getHistory(5);
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe('completed');
    expect(history[0]?.downloaded).toBe(5);
  });
});
