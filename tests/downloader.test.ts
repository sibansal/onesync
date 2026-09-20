import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { downloadFile, getPartPath } from '../src/main/sync/downloader';
import { MockDrive } from '../src/main/onedrive/mockDrive';
import { AppDatabase } from '../src/main/db/database';
import { ItemsRepo } from '../src/main/db/itemsRepo';

describe('Downloader with MockDrive', () => {
  const testDir = join(__dirname, 'temp_downloader_test');
  let appDb: AppDatabase;
  let itemsRepo: ItemsRepo;
  let mockDrive: MockDrive;

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
    appDb = new AppDatabase(testDir);
    itemsRepo = new ItemsRepo(appDb.open());
    mockDrive = new MockDrive();
  });

  afterEach(() => {
    appDb.close();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('downloads file completely and updates DB row', async () => {
    mockDrive.addFile('f1', 'root', 'test.txt', 'Hello World', { hashType: 'sha256' });
    const item = {
      id: 'f1',
      parentId: 'root',
      name: 'test.txt',
      isFolder: false,
      size: 11,
      fingerprint: 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
      hashType: 'sha256' as const,
      remoteModified: '2026-09-19T12:00:00Z',
    };

    itemsRepo.upsertBatch([item]);

    const result = await downloadFile(item, 'test.txt', {
      baseFolder: testDir,
      remoteDrive: mockDrive,
      itemsRepo,
    });

    expect(result.localSize).toBe(11);
    expect(existsSync(join(testDir, 'onedrive', 'test.txt'))).toBe(true);
    expect(readFileSync(join(testDir, 'onedrive', 'test.txt'), 'utf-8')).toBe('Hello World');

    const dbRecord = itemsRepo.getItem('f1');
    expect(dbRecord?.status).toBe('synced');
    expect(dbRecord?.local_path).toBe('test.txt');
  });

  it('resumes partially downloaded .part file using Range header', async () => {
    const fullContent = '0123456789ABCDEF';
    mockDrive.addFile('f2', 'root', 'data.bin', fullContent, { hashType: 'sha256' });
    const item = {
      id: 'f2',
      parentId: 'root',
      name: 'data.bin',
      isFolder: false,
      size: fullContent.length,
      fingerprint: (
        mockDrive as unknown as { items: Map<string, { item: { fingerprint: string } }> }
      ).items.get('f2')!.item.fingerprint,
      hashType: 'sha256' as const,
      remoteModified: '2026-09-19T12:00:00Z',
    };

    itemsRepo.upsertBatch([item]);

    // Create partial file in .onesync/tmp/
    const tmpDir = join(testDir, '.onesync', 'tmp');
    mkdirSync(tmpDir, { recursive: true });
    const fpPrefix = (item.fingerprint || 'initial').slice(0, 8);
    const partPath = join(tmpDir, `${item.id}-${fpPrefix}.part`);
    writeFileSync(partPath, '0123457'); // 7 bytes written

    // Fix partial content to match exact prefix
    writeFileSync(partPath, fullContent.slice(0, 8));

    const result = await downloadFile(item, 'data.bin', {
      baseFolder: testDir,
      remoteDrive: mockDrive,
      itemsRepo,
    });

    expect(result.localSize).toBe(fullContent.length);
    expect(readFileSync(join(testDir, 'onedrive', 'data.bin'), 'utf-8')).toBe(fullContent);
  });

  it('restarts and truncates if server ignores Range and returns 200', async () => {
    const fullContent = 'ServerReplacedFullContent';
    mockDrive.addFile('f3', 'root', 'replace.txt', fullContent, { hashType: 'sha256' });
    mockDrive.setIgnoreRange(true); // Server returns full stream from 0

    const item = {
      id: 'f3',
      parentId: 'root',
      name: 'replace.txt',
      isFolder: false,
      size: fullContent.length,
      fingerprint: (
        mockDrive as unknown as { items: Map<string, { item: { fingerprint: string } }> }
      ).items.get('f3')!.item.fingerprint,
      hashType: 'sha256' as const,
      remoteModified: '2026-09-19T12:00:00Z',
    };

    itemsRepo.upsertBatch([item]);

    const result = await downloadFile(item, 'replace.txt', {
      baseFolder: testDir,
      remoteDrive: mockDrive,
      itemsRepo,
    });

    expect(result.localSize).toBe(fullContent.length);
    expect(readFileSync(join(testDir, 'onedrive', 'replace.txt'), 'utf-8')).toBe(fullContent);
  });

  it('deletes .part file and throws HASH_MISMATCH when hash differs', async () => {
    mockDrive.addFile('f4', 'root', 'corrupt.txt', 'Actual Data', { hashType: 'sha256' });
    const item = {
      id: 'f4',
      parentId: 'root',
      name: 'corrupt.txt',
      isFolder: false,
      size: 11,
      fingerprint: 'bad_hash_that_does_not_match',
      hashType: 'sha256' as const,
      remoteModified: '2026-09-19T12:00:00Z',
    };

    itemsRepo.upsertBatch([item]);

    await expect(
      downloadFile(item, 'corrupt.txt', {
        baseFolder: testDir,
        remoteDrive: mockDrive,
        itemsRepo,
      }),
    ).rejects.toThrow('Hash verification failed');

    // Verify .part was deleted
    const fpPrefix = item.fingerprint.slice(0, 8);
    expect(existsSync(join(testDir, '.onesync', 'tmp', `${item.id}-${fpPrefix}.part`))).toBe(false);
  });

  it('correctly sanitizes partPath when fingerprint or item ID contains slashes or illegal chars', () => {
    const tmpDir = join(testDir, '.onesync', 'tmp');

    // Reproducing exact production case: QuickXorHash with '/' in the first 8 characters
    const partPath = getPartPath(
      tmpDir,
      '1B9CF09C5E1DF557!s55a663c81a454897a48e2c0279df72fc',
      'c2/eUCZ12345678',
    );

    // The resulting file path must be directly inside tmpDir, without subdirectories
    expect(dirname(partPath)).toBe(tmpDir);
    expect(partPath).not.toContain('/eUCZ');
    expect(partPath.endsWith('.part')).toBe(true);

    // Also verify special characters like colon or backslash in item ID
    const specialPath = getPartPath(tmpDir, 'item:id/with\\slash', 'tag"with<chars>');
    expect(dirname(specialPath)).toBe(tmpDir);
    expect(specialPath.endsWith('.part')).toBe(true);
  });

  it('downloads successfully when item fingerprint contains slashes (e.g. QuickXorHash)', async () => {
    const content = 'File with QuickXorHash containing slash';
    const fakeBase64FpWithSlash = 'c2/eUCZtest123456=';
    const itemId = '1B9CF09C5E1DF557!s55a663c81a454897a48e2c0279df72fc';

    mockDrive.addFile(itemId, 'root', 'yukti.pub', content, {
      hashType: 'quickXor',
    });

    const item = {
      id: itemId,
      parentId: 'root',
      name: 'yukti.pub',
      isFolder: false,
      size: Buffer.byteLength(content, 'utf8'),
      fingerprint: null, // Null to skip verification or let mockDrive supply
      hashType: null,
      remoteModified: '2026-09-20T10:00:00Z',
    };

    itemsRepo.upsertBatch([item]);

    // Set fingerprint on the item to the slash-containing fingerprint
    const itemWithFp = {
      ...item,
      fingerprint: fakeBase64FpWithSlash,
      hashType: null,
    };

    const result = await downloadFile(itemWithFp, 'yukti.pub', {
      baseFolder: testDir,
      remoteDrive: mockDrive,
      itemsRepo,
    });

    expect(result.localSize).toBe(Buffer.byteLength(content, 'utf8'));
    const downloadedPath = join(testDir, 'onedrive', 'yukti.pub');
    expect(existsSync(downloadedPath)).toBe(true);
    expect(readFileSync(downloadedPath, 'utf-8')).toBe(content);

    const dbRecord = itemsRepo.getItem(itemId);
    expect(dbRecord?.status).toBe('synced');
    expect(dbRecord?.local_path).toBe('yukti.pub');
  });
});
