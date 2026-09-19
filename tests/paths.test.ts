import { describe, it, expect } from 'vitest';
import { sanitizeSegment, resolveItemPaths } from '../src/main/fs/paths';

describe('paths.ts', () => {
  describe('sanitizeSegment', () => {
    it('replaces forbidden filesystem characters with underscore', () => {
      expect(sanitizeSegment('file:name*with?illegal"chars<here>and|pipe\\slash/test.txt')).toBe(
        'file_name_with_illegal_chars_here_and_pipe_slash_test.txt'
      );
    });

    it('strips ASCII control characters', () => {
      expect(sanitizeSegment('clean\x00\x08\x1f\x7ftext.pdf')).toBe('cleantext.pdf');
    });

    it('trims trailing spaces and periods', () => {
      expect(sanitizeSegment('document. ')).toBe('document');
      expect(sanitizeSegment('report...')).toBe('report');
      expect(sanitizeSegment('my file . . .')).toBe('my file');
    });

    it('normalizes to Unicode NFC', () => {
      // Decomposed "e\u0301" vs precomposed "\u00e9"
      const decomposed = 'caf\u0065\u0301.txt';
      const precomposed = 'caf\u00e9.txt';
      expect(sanitizeSegment(decomposed)).toBe(precomposed);
    });

    it('caps segments at 255 bytes while preserving file extension', () => {
      const longBase = 'a'.repeat(300);
      const filename = `${longBase}.json`;
      const sanitized = sanitizeSegment(filename);

      expect(Buffer.byteLength(sanitized, 'utf8')).toBeLessThanOrEqual(255);
      expect(sanitized.endsWith('.json')).toBe(true);
    });
  });

  describe('resolveItemPaths & collision handling', () => {
    it('resolves parent hierarchy to relative path', () => {
      const itemMap = new Map([
        { id: 'root', name: '', parentId: null, isFolder: true },
        { id: 'folder1', name: 'Documents', parentId: 'root', isFolder: true },
        { id: 'file1', name: 'report.pdf', parentId: 'folder1', isFolder: false }
      ].map((item) => [item.id, item]));

      const items = [{ id: 'file1', name: 'report.pdf', parentId: 'folder1' }];
      const paths = resolveItemPaths(items, itemMap);

      expect(paths.get('file1')).toBe('Documents/report.pdf');
    });

    it('appends deterministic suffix when two items map to the same path', () => {
      const itemMap = new Map([
        { id: 'root', name: '', parentId: null, isFolder: true },
        { id: 'file1', name: 'My:File.txt', parentId: 'root', isFolder: false },
        { id: 'file2', name: 'My*File.txt', parentId: 'root', isFolder: false }
      ].map((item) => [item.id, item]));

      const items = [
        { id: 'file1', name: 'My:File.txt', parentId: 'root' },
        { id: 'file2', name: 'My*File.txt', parentId: 'root' }
      ];

      const paths = resolveItemPaths(items, itemMap);

      // Both would sanitize to My_File.txt
      const path1 = paths.get('file1');
      const path2 = paths.get('file2');

      expect(path1).toBe('My_File.txt');
      expect(path2).toBe('My_File (file2).txt');
    });
  });
});
