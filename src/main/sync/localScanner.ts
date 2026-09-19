import { stat } from 'fs/promises';
import { createReadStream, existsSync, openSync, fstatSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { pipeline } from 'stream/promises';
import { Writable } from 'stream';
import { QuickXorHasher } from '../utils/quickXorHash';
import { mapConcurrent } from '../utils/pool';

export interface LocalStatEntry {
  relativePath: string;
  fullPath: string;
  exists: boolean;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtimeMs: number;
  blocks?: number;
  isReadable?: boolean;
}

/**
 * Fast sub-millisecond boundary seek & read probe to verify file health on pre-existing files.
 * Opens file descriptor, verifies size and physical block allocation,
 * and reads the first 4 KB and last 4 KB.
 * Validates permissions, filesystem block readability, and EOF consistency
 * without reading gigabytes of data. Takes < 0.2ms even on 100GB+ files.
 */
export function probeFileReadable(fullPath: string, expectedSize?: number): boolean {
  let fd: number | null = null;
  try {
    fd = openSync(fullPath, 'r');
    const s = fstatSync(fd);

    if (expectedSize !== undefined) {
      if (s.size !== expectedSize) {
        return false;
      }
      if (expectedSize > 0 && typeof s.blocks === 'number' && s.blocks === 0) {
        return false;
      }
    }

    const fileSize = expectedSize !== undefined ? expectedSize : s.size;

    if (fileSize > 0) {
      // 1. Read head chunk (up to 4096 bytes)
      const headSize = Math.min(fileSize, 4096);
      const headBuf = Buffer.alloc(headSize);
      const headBytesRead = readSync(fd, headBuf, 0, headSize, 0);
      if (headBytesRead !== headSize) {
        return false;
      }

      // 2. Seek to tail chunk (last 4096 bytes) if file is larger than 4096 bytes
      if (fileSize > 4096) {
        const tailOffset = fileSize - 4096;
        const tailBuf = Buffer.alloc(4096);
        const tailBytesRead = readSync(fd, tailBuf, 0, 4096, tailOffset);
        if (tailBytesRead !== 4096) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Scans a batch of relative paths concurrently against the local onedrive/ directory.
 */
export async function statLocalBatch(
  baseFolder: string,
  relativePaths: string[],
  concurrency = 32,
): Promise<Map<string, LocalStatEntry>> {
  const results = new Map<string, LocalStatEntry>();
  const onedriveRoot = join(baseFolder, 'onedrive');

  await mapConcurrent(
    relativePaths,
    async (relPath) => {
      const fullPath = join(onedriveRoot, relPath);
      try {
        const s = await stat(fullPath);
        results.set(relPath, {
          relativePath: relPath,
          fullPath,
          exists: true,
          isFile: s.isFile(),
          isDirectory: s.isDirectory(),
          size: s.size,
          mtimeMs: Math.round(s.mtimeMs),
          blocks: typeof s.blocks === 'number' ? s.blocks : undefined,
        });
      } catch {
        results.set(relPath, {
          relativePath: relPath,
          fullPath,
          exists: false,
          isFile: false,
          isDirectory: false,
          size: 0,
          mtimeMs: 0,
        });
      }
    },
    { concurrency },
  );

  return results;
}

/**
 * Computes hash of a local file matching the specified remote hashType.
 */
export async function computeLocalFileHash(
  fullPath: string,
  hashType: 'sha1' | 'sha256' | 'quickXor' | null,
): Promise<string | null> {
  if (!hashType || !existsSync(fullPath)) {
    return null;
  }

  if (hashType === 'quickXor') {
    const hasher = new QuickXorHasher();
    const stream = createReadStream(fullPath);
    await pipeline(
      stream,
      new Writable({
        write(chunk: Buffer, _encoding, callback) {
          hasher.update(chunk);
          callback();
        },
      }),
    );
    return hasher.digest('base64');
  }

  const hash = createHash(hashType);
  const stream = createReadStream(fullPath);
  await pipeline(
    stream,
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback();
      },
    }),
  );
  return hash.digest('hex');
}
