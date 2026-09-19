import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { safeMove, moveToRestored } from '../src/main/fs/safeMove';

describe('safeMove & moveToRestored', () => {
  const testDir = join(__dirname, 'temp_safemove_test');

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('moves file atomically and creates parent directories', () => {
    const src = join(testDir, 'source.txt');
    const dest = join(testDir, 'nested', 'target.txt');
    writeFileSync(src, 'content');

    safeMove(src, dest);
    expect(existsSync(dest)).toBe(true);
    expect(existsSync(src)).toBe(false);
    expect(readFileSync(dest, 'utf-8')).toBe('content');
  });

  it('moves orphan to restored folder and preserves relative structure', () => {
    const onedriveDir = join(testDir, 'onedrive', 'docs');
    mkdirSync(onedriveDir, { recursive: true });
    const srcFile = join(onedriveDir, 'old.pdf');
    writeFileSync(srcFile, 'pdf-data');

    const restoredRel = moveToRestored({
      baseFolder: testDir,
      sourceFullPath: srcFile,
      relativePath: 'docs/old.pdf'
    });

    expect(restoredRel.startsWith('docs/old')).toBe(true);
    expect(existsSync(join(testDir, 'restored', restoredRel))).toBe(true);
    expect(existsSync(srcFile)).toBe(false);
  });

  it('renames with timestamp on collision in restored/', () => {
    const restoredDir = join(testDir, 'restored');
    mkdirSync(restoredDir, { recursive: true });

    // Existing file in restored
    writeFileSync(join(restoredDir, 'file.txt'), 'version1');

    // Another file to move
    const srcFile = join(testDir, 'file.txt');
    writeFileSync(srcFile, 'version2');

    const restoredRel = moveToRestored({
      baseFolder: testDir,
      sourceFullPath: srcFile,
      relativePath: 'file.txt'
    });

    expect(restoredRel).toContain('(restored ');
    expect(existsSync(join(testDir, 'restored', 'file.txt'))).toBe(true);
    expect(readFileSync(join(testDir, 'restored', 'file.txt'), 'utf-8')).toBe('version1');
    expect(readFileSync(join(testDir, 'restored', restoredRel), 'utf-8')).toBe('version2');
  });
});
