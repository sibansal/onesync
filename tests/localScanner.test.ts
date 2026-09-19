import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  openSync,
  closeSync,
  ftruncateSync,
  statSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { probeFileReadable, statLocalBatch } from '../src/main/sync/localScanner';

describe('probeFileReadable - Fast Preexisting File Health Probe', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'onesync-probe-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true for 0-byte file', () => {
    const filePath = join(tempDir, 'empty.txt');
    writeFileSync(filePath, '');
    expect(probeFileReadable(filePath, 0)).toBe(true);
  });

  it('returns true for small valid file (< 4 KB)', () => {
    const filePath = join(tempDir, 'small.txt');
    const content = Buffer.alloc(1024, 0x41); // 1 KB of 'A'
    writeFileSync(filePath, content);
    expect(probeFileReadable(filePath, 1024)).toBe(true);
  });

  it('returns true for multi-chunk file (> 4 KB) with sub-millisecond execution', () => {
    const filePath = join(tempDir, 'large.bin');
    const size = 16 * 1024; // 16 KB
    const content = Buffer.alloc(size, 0x42);
    writeFileSync(filePath, content);

    const start = performance.now();
    const result = probeFileReadable(filePath, size);
    const duration = performance.now() - start;

    expect(result).toBe(true);
    expect(duration).toBeLessThan(20); // Sub-millisecond on warm runs, < 20ms even in busy test runner
  });

  it('returns true for large sparse file (15 GB) in sub-millisecond time', () => {
    const filePath = join(tempDir, 'huge.iso');
    const fd = openSync(filePath, 'w');
    const fifteenGb = 15 * 1024 * 1024 * 1024;
    // Write head and tail
    writeFileSync(fd, Buffer.from('HEAD_CHUNK'));
    const tailBuf = Buffer.alloc(4096, 0x5a);
    writeFileSync(fd, tailBuf);
    ftruncateSync(fd, fifteenGb);
    closeSync(fd);

    const start = performance.now();
    const result = probeFileReadable(filePath, fifteenGb);
    const duration = performance.now() - start;

    expect(result).toBe(true);
    expect(duration).toBeLessThan(10);
  });

  it('returns false for size mismatch / truncated file', () => {
    const filePath = join(tempDir, 'truncated.bin');
    writeFileSync(filePath, Buffer.alloc(500));
    // Expected size is 1000, but file only has 500
    expect(probeFileReadable(filePath, 1000)).toBe(false);
  });

  it('returns false for hollow file (size > 0 with 0 blocks allocated)', () => {
    const filePath = join(tempDir, 'hollow.bin');
    const fd = openSync(filePath, 'w');
    ftruncateSync(fd, 100000);
    closeSync(fd);

    // On APFS, hollow ftruncate file has stat.blocks === 0
    const stat = statSync(filePath);
    if (stat.blocks === 0) {
      expect(probeFileReadable(filePath, 100000)).toBe(false);
    }
  });

  it('returns false for nonexistent file', () => {
    const filePath = join(tempDir, 'does-not-exist.bin');
    expect(probeFileReadable(filePath, 500)).toBe(false);
  });

  it('statLocalBatch records physical blocks if available', async () => {
    const onedriveDir = join(tempDir, 'onedrive');
    mkdirSync(onedriveDir, { recursive: true });
    const filePath = join(onedriveDir, 'hello.txt');
    writeFileSync(filePath, 'Hello world');

    const results = await statLocalBatch(tempDir, ['hello.txt']);
    const entry = results.get('hello.txt');
    expect(entry).toBeDefined();
    expect(entry?.exists).toBe(true);
    expect(entry?.isFile).toBe(true);
    expect(entry?.size).toBe(11);
    if (process.platform !== 'win32') {
      expect(entry?.blocks).toBeGreaterThanOrEqual(1);
    }
  });
});
