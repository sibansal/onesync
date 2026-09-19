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
      email: 'other@example.com',
    });

    const result = await engine.startSync();
    expect(result.success).toBe(false);
    expect(result.error).toContain('different OneDrive account');
  });

  it('cancels sync cleanly when cancelSync() is called mid-run', async () => {
    mockDrive.addFile('f1', 'root', 'large1.dat', Buffer.alloc(1024 * 1024, 1));
    mockDrive.addFile('f2', 'root', 'large2.dat', Buffer.alloc(1024 * 1024, 2));

    const syncPromise = engine.startSync();

    // Give it a tiny tick to begin
    await new Promise((r) => setTimeout(r, 10));
    engine.cancelSync();

    const result = await syncPromise;
    expect(result.success).toBe(false);
    expect(result.error).toContain('cancelled by user');
    expect(engine.getState().isRunning).toBe(false);
    expect(engine.getState().phase).toBe('idle');
  });

  it('pauses and resumes sync when pauseSync() and resumeSync() are called', async () => {
    mockDrive.addFile('f1', 'root', 'file1.txt', 'Hello world');

    const syncPromise = engine.startSync();
    engine.pauseSync();
    expect(engine.getState().isPaused).toBe(true);

    await new Promise((r) => setTimeout(r, 250));
    engine.resumeSync();
    expect(engine.getState().isPaused).toBe(false);

    const result = await syncPromise;
    expect(result.success).toBe(true);
    expect(engine.getState().isRunning).toBe(false);
  });

  it('associates Job ID with every sync job, records status: cancelled, and allows restart', async () => {
    mockDrive.addFile('f1', 'root', 'job_file.txt', 'job content');

    // Run 1: cancel mid-run
    const sync1 = engine.startSync();
    await new Promise((r) => setTimeout(r, 5));
    engine.cancelSync();
    const res1 = await sync1;
    expect(res1.success).toBe(false);
    expect(engine.getState().isCancelled).toBe(true);
    expect(engine.getState().jobId).toBe('Job #1');

    const historyAfterCancel = engine.getDb().syncRunsRepo.getHistory(5);
    expect(historyAfterCancel[0]?.status).toBe('cancelled');
    expect(historyAfterCancel[0]?.id).toBe(1);

    // Restart Sync (Run 2)
    const sync2 = await engine.startSync();
    expect(sync2.success).toBe(true);
    expect(engine.getState().jobId).toBe('Job #2');
    expect(engine.getState().isCancelled).toBe(false);

    const historyAfterRestart = engine.getDb().syncRunsRepo.getHistory(5);
    expect(historyAfterRestart[0]?.status).toBe('completed');
    expect(historyAfterRestart[0]?.id).toBe(2);
  });

  it('clears database and resets indexing state cleanly', async () => {
    mockDrive.addFile('f1', 'root', 'fileA.txt', 'AAA');
    await engine.startSync();

    const dbPath = join(testDir, '.onesync', 'state.db');
    expect(existsSync(dbPath)).toBe(true);

    const clearRes = engine.clearDatabase();
    expect(clearRes.success).toBe(true);
    expect(engine.getState().jobId).toBeNull();
    expect(engine.getState().phase).toBe('idle');

    // Newly recreated database should have 0 items
    const { itemsRepo } = engine.getDb();
    expect(itemsRepo.getCount()).toBe(0);
  });

  it('filters synchronization when a single source directory is selected', async () => {
    mockDrive.addFolder('docs', 'root', 'Documents');
    mockDrive.addFile('doc1', 'docs', 'report.pdf', 'PDF report');
    mockDrive.addFolder('pics', 'root', 'Pictures');
    mockDrive.addFile('pic1', 'pics', 'photo.jpg', 'JPG image');

    // Scope to /Documents
    engine.setSourceFolder('/Documents');
    expect(engine.getSourceFolder()).toBe('/Documents');

    const res = await engine.startSync();
    expect(res.success).toBe(true);

    // Only Documents should be downloaded
    expect(existsSync(join(testDir, 'onedrive', 'Documents', 'report.pdf'))).toBe(true);
    expect(existsSync(join(testDir, 'onedrive', 'Pictures', 'photo.jpg'))).toBe(false);
  });

  it('cancelSyncAndWait cleanly waits for cancellation and releases isRunning immediately', async () => {
    mockDrive.addFile('f1', 'root', 'fileLarge.dat', Buffer.alloc(1024 * 1024, 1));
    const syncPromise = engine.startSync();
    await new Promise((r) => setTimeout(r, 5));
    await engine.cancelSyncAndWait();
    expect(engine.getState().isRunning).toBe(false);
    expect(engine.getState().isCancelled).toBe(true);
    const syncRes = await syncPromise;
    expect(syncRes.success).toBe(false);

    // Can immediately start next run without "already running" error
    const nextSync = await engine.startSync();
    expect(nextSync.success).toBe(true);
    expect(engine.getState().isCancelled).toBe(false);
  });

  it('app restart with existing sourceFolder preserves catalog and does not move files to restored', async () => {
    mockDrive.addFolder('ws', 'root', 'Workspace');
    mockDrive.addFile('f1', 'ws', 'code.ts', 'console.log("hello");');

    // Run 1: initial sync with /Workspace
    engine.setSourceFolder('/Workspace');
    const run1 = await engine.startSync();
    expect(run1.success).toBe(true);
    expect(existsSync(join(testDir, 'onedrive', 'Workspace', 'code.ts'))).toBe(true);

    // Simulate app restart: create a new SyncEngine instance as happens on app launch
    const restartedEngine = new SyncEngine(mockDrive, mockListeners);
    restartedEngine.setDestination(testDir);
    restartedEngine.setAccount({
      id: 'mock_user_account_id',
      name: 'Mock User',
      email: 'mock@example.com',
    });
    // ipc.ts restores saved sourceFolder from settingsStore
    restartedEngine.setSourceFolder('/Workspace');

    // Items table in DB must NOT have been deleted
    const { itemsRepo } = restartedEngine.getDb();
    expect(itemsRepo.getCount()).toBeGreaterThan(0);

    // Run 2: sync on restarted engine
    const run2 = await restartedEngine.startSync();
    expect(run2.success).toBe(true);
    expect(restartedEngine.getProgress().restoredCount).toBe(0);
    expect(existsSync(join(testDir, 'onedrive', 'Workspace', 'code.ts'))).toBe(true);
    expect(existsSync(join(testDir, 'restored'))).toBe(false);
  });
});
