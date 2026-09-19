import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { sweepOrphans } from '../src/main/sync/orphanSweeper';
import { RestoredLogRepo } from '../src/main/db/logRepo';
import { AppDatabase } from '../src/main/db/database';

describe('orphanSweeper', () => {
  const testDir = join(__dirname, 'temp_sweeper_test');
  let appDb: AppDatabase;
  let restoredRepo: RestoredLogRepo;

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(join(testDir, 'onedrive', 'sub'), { recursive: true });
    appDb = new AppDatabase(testDir);
    restoredRepo = new RestoredLogRepo(appDb.open());
  });

  afterEach(() => {
    appDb.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('moves orphan to restored/ with directory structure preserved', async () => {
    const liveFile = join(testDir, 'onedrive', 'live.txt');
    const orphanFile = join(testDir, 'onedrive', 'sub', 'orphan.txt');
    writeFileSync(liveFile, 'live');
    writeFileSync(orphanFile, 'orphan');

    const expectedPaths = new Set(['live.txt']);
    const { movedCount } = await sweepOrphans({
      baseFolder: testDir,
      expectedPaths,
      restoredLogRepo: restoredRepo,
      gatingAllowed: true,
    });

    expect(movedCount).toBe(1);
    expect(existsSync(liveFile)).toBe(true);
    expect(existsSync(orphanFile)).toBe(false);
    expect(existsSync(join(testDir, 'restored', 'sub', 'orphan.txt'))).toBe(true);

    const logs = restoredRepo.getRecent(5);
    expect(logs).toHaveLength(1);
    expect(logs[0]?.originalPath).toBe('sub/orphan.txt');
  });

  it('respects ignore list and leaves .DS_Store untouched', async () => {
    const dsStore = join(testDir, 'onedrive', '.DS_Store');
    writeFileSync(dsStore, 'dummy');

    const { movedCount } = await sweepOrphans({
      baseFolder: testDir,
      expectedPaths: new Set(),
      restoredLogRepo: restoredRepo,
      gatingAllowed: true,
    });

    expect(movedCount).toBe(0);
    expect(existsSync(dsStore)).toBe(true);
  });

  it('does not move anything when gating flag is off', async () => {
    const orphanFile = join(testDir, 'onedrive', 'orphan.txt');
    writeFileSync(orphanFile, 'data');

    const { movedCount } = await sweepOrphans({
      baseFolder: testDir,
      expectedPaths: new Set(),
      restoredLogRepo: restoredRepo,
      gatingAllowed: false, // e.g. aborted or incomplete discovery
    });

    expect(movedCount).toBe(0);
    expect(existsSync(orphanFile)).toBe(true);
  });

  it('preserves files that match expected paths case-insensitively on macOS', async () => {
    const casedFile = join(testDir, 'onedrive', 'Report.PDF');
    writeFileSync(casedFile, 'some content');

    const expectedPaths = new Set(['report.pdf']);
    const { movedCount } = await sweepOrphans({
      baseFolder: testDir,
      expectedPaths,
      restoredLogRepo: restoredRepo,
      gatingAllowed: true,
    });

    expect(movedCount).toBe(0);
    expect(existsSync(casedFile)).toBe(true);
  });

  it('preserves existing file when equivalent to cloud item and marks it synced in itemsRepo', async () => {
    const existingFile = join(testDir, 'onedrive', 'photo.jpg');
    const content = 'JPEG image data payload';
    writeFileSync(existingFile, content);

    const { ItemsRepo } = await import('../src/main/db/itemsRepo');
    const itemsRepo = new ItemsRepo(appDb.getRawDb());
    itemsRepo.upsertBatch([
      {
        id: 'photo_id',
        parentId: 'root',
        name: 'photo.jpg',
        isFolder: false,
        size: Buffer.byteLength(content),
        fingerprint: 'mock_fp',
        hashType: null,
        remoteModified: new Date().toISOString(),
      },
    ]);

    const cloudItems = new Map([
      [
        'photo.jpg',
        {
          id: 'photo_id',
          desiredPath: 'photo.jpg',
          size: Buffer.byteLength(content),
          fingerprint: 'mock_fp',
        },
      ],
    ]);

    // expectedPaths is intentionally empty (e.g. fresh DB before expectedPaths computed)
    const { movedCount } = await sweepOrphans({
      baseFolder: testDir,
      expectedPaths: new Set(),
      restoredLogRepo: restoredRepo,
      gatingAllowed: true,
      itemsRepo,
      cloudItems,
    });

    expect(movedCount).toBe(0);
    expect(existsSync(existingFile)).toBe(true);
    const dbItem = itemsRepo.getItem('photo_id');
    expect(dbItem?.status).toBe('synced');
    expect(dbItem?.local_path).toBe('photo.jpg');
  });
});
