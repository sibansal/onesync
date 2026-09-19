import { stat } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
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
}

/**
 * Scans a batch of relative paths concurrently against the local onedrive/ directory.
 */
export async function statLocalBatch(
  baseFolder: string,
  relativePaths: string[],
  concurrency = 32
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
          mtimeMs: Math.round(s.mtimeMs)
        });
      } catch {
        results.set(relPath, {
          relativePath: relPath,
          fullPath,
          exists: false,
          isFile: false,
          isDirectory: false,
          size: 0,
          mtimeMs: 0
        });
      }
    },
    { concurrency }
  );

  return results;
}

/**
 * Computes hash of a local file matching the specified remote hashType.
 */
export async function computeLocalFileHash(
  fullPath: string,
  hashType: 'sha1' | 'sha256' | 'quickXor' | null
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
        }
      })
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
      }
    })
  );
  return hash.digest('hex');
}
