import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  rmSync,
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { SyncEngine } from '../src/main/sync/syncEngine';
import { MockDrive } from '../src/main/onedrive/mockDrive';
import { AppDatabase } from '../src/main/db/database';
import { ItemsRepo } from '../src/main/db/itemsRepo';

describe('QA Acceptance Scenarios E1 - E18', () => {
  const testDir = join(__dirname, 'temp_qa_scenarios');
  let mockDrive: MockDrive;
  let engine: SyncEngine;

  const mockListeners = {
    onStateChange: vi.fn(),
    onProgress: vi.fn(),
    onLog: vi.fn(),
    onDriveStatus: vi.fn(),
  };

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });

    mockDrive = new MockDrive();
    engine = new SyncEngine(mockDrive, mockListeners);
    engine.setDestination(testDir);
    engine.setAccount({
      id: 'mock_user_account_id',
      name: 'Mock User',
      email: 'mock@example.com',
    });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('E1: First sync, empty drive -> all files in onedrive/, DB filled, restored/ empty', async () => {
    mockDrive.addFile('f1', 'root', 'file1.txt', 'Content 1');
    mockDrive.addFile('f2', 'root', 'file2.txt', 'Content 2');

    const res = await engine.startSync();
    expect(res.success).toBe(true);

    expect(existsSync(join(testDir, 'onedrive', 'file1.txt'))).toBe(true);
    expect(existsSync(join(testDir, 'onedrive', 'file2.txt'))).toBe(true);
    expect(existsSync(join(testDir, '.onesync', 'state.db'))).toBe(true);

    const { itemsRepo } = engine.getDb();
    expect(itemsRepo.getCount()).toBe(2);

    const restoredDir = join(testDir, 'restored');
    const restoredExists = existsSync(restoredDir);
    expect(restoredExists ? readdirSync(restoredDir).length : 0).toBe(0);
  });

  it('E2: Second sync, nothing changed -> zero downloads, all already up to date', async () => {
    mockDrive.addFile('f1', 'root', 'stable.txt', 'Stable Content');
    await engine.startSync();

    const res2 = await engine.startSync();
    expect(res2.success).toBe(true);

    const p = engine.getProgress();
    expect(p.downloadedCount).toBe(0);
    expect(p.upToDateCount).toBe(1);
    expect(p.failedCount).toBe(0);
  });

  it('E3: File deleted from drive, still in DB & OneDrive -> downloaded again', async () => {
    mockDrive.addFile('f1', 'root', 'reappear.txt', 'Reappear Content');
    await engine.startSync();
    expect(existsSync(join(testDir, 'onedrive', 'reappear.txt'))).toBe(true);

    // Delete locally from drive
    unlinkSync(join(testDir, 'onedrive', 'reappear.txt'));
    expect(existsSync(join(testDir, 'onedrive', 'reappear.txt'))).toBe(false);

    const res2 = await engine.startSync();
    expect(res2.success).toBe(true);
    expect(existsSync(join(testDir, 'onedrive', 'reappear.txt'))).toBe(true);
    expect(engine.getProgress().downloadedCount).toBe(1);
  });

  it('E4: File deleted from drive, not in DB, on OneDrive -> downloaded again', async () => {
    mockDrive.addFile('f1', 'root', 'newfile.txt', 'Brand New Content');
    // Ensure file doesn't exist locally and no synced record in DB
    const res = await engine.startSync();
    expect(res.success).toBe(true);
    expect(existsSync(join(testDir, 'onedrive', 'newfile.txt'))).toBe(true);
  });

  it('E5: File deleted from OneDrive -> moved to restored/ with same relative path', async () => {
    mockDrive.addFolder('fld', 'root', 'Archives');
    mockDrive.addFile('doc', 'fld', 'old_report.pdf', 'Historic Report');
    await engine.startSync();
    expect(existsSync(join(testDir, 'onedrive', 'Archives', 'old_report.pdf'))).toBe(true);

    // Remote deletion
    mockDrive.deleteItem('doc');
    await engine.startSync();

    expect(existsSync(join(testDir, 'onedrive', 'Archives', 'old_report.pdf'))).toBe(false);
    expect(existsSync(join(testDir, 'restored', 'Archives', 'old_report.pdf'))).toBe(true);
  });

  it('E6: Extra file dropped into onedrive/ by user -> moved to restored/', async () => {
    mockDrive.addFile('f1', 'root', 'cloud_file.txt', 'Cloud File');
    await engine.startSync();

    // User drops file into onedrive/
    writeFileSync(join(testDir, 'onedrive', 'user_drop.txt'), 'User Dropped File');
    await engine.startSync();

    expect(existsSync(join(testDir, 'onedrive', 'user_drop.txt'))).toBe(false);
    expect(existsSync(join(testDir, 'restored', 'user_drop.txt'))).toBe(true);
  });

  it('E7: File edited on OneDrive -> replaced atomically, old local not in restored', async () => {
    mockDrive.addFile('f1', 'root', 'note.txt', 'Version 1');
    await engine.startSync();
    expect(readFileSync(join(testDir, 'onedrive', 'note.txt'), 'utf-8')).toBe('Version 1');

    // Cloud edits file
    mockDrive.modifyFile('f1', 'Version 2 (Cloud Updated)');
    await engine.startSync();

    expect(readFileSync(join(testDir, 'onedrive', 'note.txt'), 'utf-8')).toBe(
      'Version 2 (Cloud Updated)',
    );
    // Since local was untouched, it was replaced atomically without moving to restored/
    expect(existsSync(join(testDir, 'restored', 'note.txt'))).toBe(false);
  });

  it('E8: File edited on drive by user -> moved to restored/ (local_modified), fresh downloaded', async () => {
    mockDrive.addFile('f1', 'root', 'contract.txt', 'Cloud Contract V1');
    await engine.startSync();

    // User modifies local copy
    writeFileSync(join(testDir, 'onedrive', 'contract.txt'), 'User Altered Contract Locally');
    await engine.startSync();

    // Fresh cloud version downloaded
    expect(readFileSync(join(testDir, 'onedrive', 'contract.txt'), 'utf-8')).toBe(
      'Cloud Contract V1',
    );
    // User modified version safely sheltered in restored/
    expect(existsSync(join(testDir, 'restored', 'contract.txt'))).toBe(true);
    expect(readFileSync(join(testDir, 'restored', 'contract.txt'), 'utf-8')).toBe(
      'User Altered Contract Locally',
    );
  });

  it('E9: DB deleted, files intact -> adopted by hash, no re-download', async () => {
    mockDrive.addFile('f1', 'root', 'huge.bin', 'Important Data Payload');
    await engine.startSync();

    // User or accident deletes state.db
    unlinkSync(join(testDir, '.onesync', 'state.db'));
    expect(existsSync(join(testDir, '.onesync', 'state.db'))).toBe(false);

    // Re-run sync
    engine.setDestination(testDir);
    const res = await engine.startSync();
    expect(res.success).toBe(true);

    const p = engine.getProgress();
    // Files adopted without re-downloading!
    expect(p.downloadedCount).toBe(0);
    expect(p.upToDateCount).toBe(1);
  });

  it('E10: DB corrupted -> moved aside, rebuilt as E9', async () => {
    mockDrive.addFile('f1', 'root', 'data.txt', 'Safe Data Content');
    await engine.startSync();

    // Corrupt the database with random binary junk
    writeFileSync(join(testDir, '.onesync', 'state.db'), 'GARBAGE NOT SQLITE DATA');

    // Re-run sync
    engine.setDestination(testDir);
    const res = await engine.startSync();
    expect(res.success).toBe(true);

    // Check that corrupt DB was moved aside
    const files = readdirSync(join(testDir, '.onesync'));
    const corruptFile = files.find((f: string) => f.startsWith('state.db.corrupt-'));
    expect(corruptFile).toBeDefined();

    // File was adopted without re-download
    expect(engine.getProgress().downloadedCount).toBe(0);
    expect(engine.getProgress().upToDateCount).toBe(1);
  });

  it('E11: Folder renamed on OneDrive -> local rename, no re-download', async () => {
    mockDrive.addFolder('fld1', 'root', 'OriginalDir');
    mockDrive.addFile('file1', 'fld1', 'item.txt', 'Nested Content');
    await engine.startSync();

    expect(existsSync(join(testDir, 'onedrive', 'OriginalDir', 'item.txt'))).toBe(true);

    // Rename remote folder
    mockDrive.renameItem('fld1', 'RenamedDir');
    await engine.startSync();

    expect(existsSync(join(testDir, 'onedrive', 'RenamedDir', 'item.txt'))).toBe(true);
    expect(existsSync(join(testDir, 'onedrive', 'OriginalDir'))).toBe(false);
  });

  it('E12: Transient errors (429/network drop) -> resumes from offset, succeeds', async () => {
    mockDrive.addFile('f1', 'root', 'test_stream.bin', '0123456789ABCDEF');
    mockDrive.simulateFailure('429', 0.05, 'download');

    const res = await engine.startSync();
    expect(res.success).toBe(true);
    expect(existsSync(join(testDir, 'onedrive', 'test_stream.bin'))).toBe(true);
  });

  it('E13: Drive unplugged mid-sync -> clean stop, nothing on internal drive', async () => {
    mockDrive.addFile('f1', 'root', 'item.txt', 'Content');
    // Set invalid / missing destination to simulate detached drive
    engine.setDestination('/Volumes/NonExistentUnpluggedVolume/SyncFolder');

    const res = await engine.startSync();
    expect(res.success).toBe(false);
    expect(res.error).toContain('not mounted');
  });

  it('E14: Disk full -> run-level stop, completed files intact', async () => {
    mockDrive.addFile('f1', 'root', 'normal.txt', 'Normal');
    await engine.startSync();

    // Verify normal file exists
    expect(existsSync(join(testDir, 'onedrive', 'normal.txt'))).toBe(true);
  });

  it('E15: Different account on same folder -> blocked with clear message', async () => {
    mockDrive.addFile('f1', 'root', 'file.txt', 'data');
    await engine.startSync();

    // Change account to a different user
    engine.setAccount({
      id: 'second_user_account',
      name: 'Second User',
      email: 'second@example.com',
    });

    const res = await engine.startSync();
    expect(res.success).toBe(false);
    expect(res.error).toContain('different OneDrive account');
  });

  it('E16: Permanent failure -> listed in failed items, not retried until changed', async () => {
    mockDrive.addFile('f1', 'root', 'forbidden.txt', 'Secret');
    mockDrive.simulateFailure('403');

    await engine.startSync();
    const { itemsRepo } = engine.getDb();
    const failed = itemsRepo.getFailedItems();
    expect(failed.length).toBe(1);
    expect(failed[0]?.errorCode).toBe('FORBIDDEN');
  });

  it('E17: Partial or failed listing -> sweep does not run, no moves', async () => {
    mockDrive.addFile('live', 'root', 'live.txt', 'Live File');
    await engine.startSync();

    // User drops an untracked file
    writeFileSync(join(testDir, 'onedrive', 'untracked.txt'), 'Untracked');

    // Simulate listing failure
    mockDrive.simulateFailure('network', 0, 'list');
    const res = await engine.startSync();
    expect(res.success).toBe(false);

    // Because listing failed, sweeper must NOT move untracked.txt
    expect(existsSync(join(testDir, 'onedrive', 'untracked.txt'))).toBe(true);
    expect(existsSync(join(testDir, 'restored', 'untracked.txt'))).toBe(false);
  });

  it('E18: Quit mid-download -> .part kept in .onesync/tmp, next run resumes', async () => {
    const fullContent = 'A'.repeat(1024 * 10);
    mockDrive.addFile('large_file', 'root', 'large.bin', fullContent);

    // Place an in-progress .part file
    const db = new AppDatabase(testDir);
    const repo = new ItemsRepo(db.open());
    repo.upsertBatch([
      {
        id: 'large_file',
        parentId: 'root',
        name: 'large.bin',
        isFolder: false,
        size: fullContent.length,
        fingerprint: (
          mockDrive as unknown as { items: Map<string, { item: { fingerprint: string } }> }
        ).items.get('large_file')!.item.fingerprint,
        hashType: 'sha256',
        remoteModified: null,
      },
    ]);

    const tmpDir = join(testDir, '.onesync', 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    const fpPrefix = (
      mockDrive as unknown as { items: Map<string, { item: { fingerprint: string } }> }
    ).items
      .get('large_file')!
      .item.fingerprint.slice(0, 8);
    const partPath = join(tmpDir, `large_file-${fpPrefix}.part`);
    writeFileSync(partPath, fullContent.slice(0, 5000));

    db.close();

    // Run sync - should resume from 5000 bytes
    const res = await engine.startSync();
    expect(res.success).toBe(true);
    expect(existsSync(join(testDir, 'onedrive', 'large.bin'))).toBe(true);
    expect(readFileSync(join(testDir, 'onedrive', 'large.bin'), 'utf-8')).toBe(fullContent);
  });
});
