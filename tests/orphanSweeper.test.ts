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
});
