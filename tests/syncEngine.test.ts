import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { SyncEngine } from '../src/main/sync/syncEngine';
import { MockDrive } from '../src/main/onedrive/mockDrive';

describe('SyncEngine with MockDrive', () => {
  const testDir = join(__dirname, 'temp_engine_test');
  let mockDrive: MockDrive;
  let engine: SyncEngine;

  const mockListeners = {
    onStateChange: vi.fn(),
    onProgress: vi.fn(),
    onLog: vi.fn(),
    onDriveStatus: vi.fn()
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
      email: 'mock@example.com'
    });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('E1: First sync on empty folder downloads files into onedrive/', async () => {
    mockDrive.addFile('file1', 'root', 'doc.pdf', 'PDF-DATA');
    mockDrive.addFolder('f1', 'root', 'Images');
    mockDrive.addFile('file2', 'f1', 'pic.png', 'PNG-DATA');

    const result = await engine.startSync();
    expect(result.success).toBe(true);

    expect(existsSync(join(testDir, 'onedrive', 'doc.pdf'))).toBe(true);
    expect(readFileSync(join(testDir, 'onedrive', 'doc.pdf'), 'utf-8')).toBe('PDF-DATA');
    expect(existsSync(join(testDir, 'onedrive', 'Images', 'pic.png'))).toBe(true);
    expect(readFileSync(join(testDir, 'onedrive', 'Images', 'pic.png'), 'utf-8')).toBe('PNG-DATA');

    const { itemsRepo } = engine.getDb();
    expect(itemsRepo.getCount()).toBe(2);
  });

  it('E2: Second sync with no changes does 0 downloads and finishes fast', async () => {
    mockDrive.addFile('f1', 'root', 'file.txt', 'Content');
    await engine.startSync();

    const result2 = await engine.startSync();
    expect(result2.success).toBe(true);

    const progress = engine.getProgress();
    expect(progress.downloadedCount).toBe(0);
    expect(progress.upToDateCount).toBe(1);
  });

  it('E5: File deleted from OneDrive moves to restored/ with relative path preserved', async () => {
    mockDrive.addFolder('f1', 'root', 'Folder');
    mockDrive.addFile('f1_file', 'f1', 'delete_me.txt', 'Data to delete');
    await engine.startSync();

    expect(existsSync(join(testDir, 'onedrive', 'Folder', 'delete_me.txt'))).toBe(true);

    // Delete remotely on OneDrive
    mockDrive.deleteItem('f1_file');
    const result = await engine.startSync();
    expect(result.success).toBe(true);

    expect(existsSync(join(testDir, 'onedrive', 'Folder', 'delete_me.txt'))).toBe(false);
    expect(existsSync(join(testDir, 'restored', 'Folder', 'delete_me.txt'))).toBe(true);
  });

  it('E6: Extra user file dropped into onedrive/ is swept to restored/', async () => {
    mockDrive.addFile('f1', 'root', 'cloud.txt', 'Cloud File');
    await engine.startSync();

    // User drops a manual file
    writeFileSync(join(testDir, 'onedrive', 'manual.txt'), 'User File');
    expect(existsSync(join(testDir, 'onedrive', 'manual.txt'))).toBe(true);

    const result = await engine.startSync();
    expect(result.success).toBe(true);

    expect(existsSync(join(testDir, 'onedrive', 'manual.txt'))).toBe(false);
    expect(existsSync(join(testDir, 'restored', 'manual.txt'))).toBe(true);
  });

  it('E11: Folder rename on OneDrive causes local rename with no redownload', async () => {
    mockDrive.addFolder('folder1', 'root', 'OldFolderName');
    mockDrive.addFile('file1', 'folder1', 'test.txt', 'File Content');
    await engine.startSync();

    expect(existsSync(join(testDir, 'onedrive', 'OldFolderName', 'test.txt'))).toBe(true);

    // Rename folder remotely
    mockDrive.renameItem('folder1', 'NewFolderName');
    const result = await engine.startSync();
    expect(result.success).toBe(true);

    expect(existsSync(join(testDir, 'onedrive', 'NewFolderName', 'test.txt'))).toBe(true);
  });

  it('E15: Blocks sync if folder belongs to different OneDrive account', async () => {
    mockDrive.addFile('f1', 'root', 'test.txt', 'data');
    await engine.startSync();

    // Now attempt sync with a different account on same folder
    engine.setAccount({
      id: 'other_user_account_id',
      name: 'Other User',
      email: 'other@example.com'
    });

    const result = await engine.startSync();
    expect(result.success).toBe(false);
    expect(result.error).toContain('different OneDrive account');
  });
});
