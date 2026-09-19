import { describe, it, expect } from 'vitest';
import { MockDrive } from '../src/main/onedrive/mockDrive';

describe('MockDrive', () => {
  it('adds files and computes hashes', async () => {
    const drive = new MockDrive();
    drive.addFolder('f1', 'root', 'Documents');
    drive.addFile('doc1', 'f1', 'test.txt', 'Hello World');

    const quota = await drive.getQuota();
    expect(quota.used).toBe(11);

    const pages: unknown[] = [];
    const delta = await drive.listChanges(null, (items) => {
      pages.push(...items);
    });

    expect(delta.isFullListing).toBe(true);
    expect(pages.length).toBe(3); // root, f1, doc1
  });

  it('supports streaming downloads and range resumption', async () => {
    const drive = new MockDrive();
    drive.addFile('file1', 'root', 'test.bin', Buffer.from('0123456789'));

    const { stream, resumed } = await drive.openDownload(
      {
        id: 'file1',
        parentId: 'root',
        name: 'test.bin',
        isFolder: false,
        size: 10,
        fingerprint: 'dummy',
        hashType: 'sha256',
        remoteModified: null,
      },
      5,
    );

    expect(resumed).toBe(true);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const full = Buffer.concat(chunks).toString('utf-8');
    expect(full).toBe('56789');
  });

  it('simulates transient errors from failure queue', async () => {
    const drive = new MockDrive();
    drive.simulateFailure('429', 2);

    await expect(drive.listChanges(null, () => {})).rejects.toThrow('Mock Rate limited');
  });
});
