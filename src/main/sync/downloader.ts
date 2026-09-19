import {
  existsSync,
  statSync,
  createWriteStream,
  createReadStream,
  unlinkSync,
  truncateSync,
  mkdirSync,
  openSync,
  closeSync,
  utimesSync
} from 'fs';
import { dirname, join } from 'path';
import { pipeline } from 'stream/promises';
import { Writable } from 'stream';
import { createHash } from 'crypto';
import type { RemoteDrive } from '../onedrive/remoteDrive';
import type { RemoteItem } from '../../shared/types';
import type { ItemsRepo } from '../db/itemsRepo';
import { SyncError } from '../utils/errors';
import { QuickXorHasher } from '../utils/quickXorHash';
import { safeMove } from '../fs/safeMove';
import { getAvailableSpace } from '../fs/volume';
import { logger } from '../logger';

const RESERVE_BYTES = 100 * 1024 * 1024; // 100 MB reserve

export interface DownloadProgressUpdate {
  itemId: string;
  bytesDone: number;
  totalBytes: number;
}

export interface DownloaderOptions {
  baseFolder: string;
  remoteDrive: RemoteDrive;
  itemsRepo: ItemsRepo;
  onProgress?: (update: DownloadProgressUpdate) => void;
  signal?: AbortSignal;
}

/**
 * Executes an atomic download with resumption and inline multi-hash verification.
 */
export async function downloadFile(
  item: RemoteItem,
  desiredRelativePath: string,
  options: DownloaderOptions
): Promise<{ finalPath: string; localSize: number; localMtimeMs: number }> {
  const { baseFolder, remoteDrive, itemsRepo, onProgress, signal } = options;
  const onedriveRoot = join(baseFolder, 'onedrive');
  const finalFullPath = join(onedriveRoot, desiredRelativePath);
  const tmpDir = join(baseFolder, '.onesync', 'tmp');

  // Handle zero-byte file without network call
  if (item.size === 0) {
    const parentDir = dirname(finalFullPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    const fd = openSync(finalFullPath, 'w');
    closeSync(fd);

    const mtime = item.remoteModified ? new Date(item.remoteModified) : new Date();
    try {
      utimesSync(finalFullPath, mtime, mtime);
    } catch {
      // Ignore utimes on filesystems that do not support it
    }

    const s = statSync(finalFullPath);
    itemsRepo.updateLocalSynced(item.id, {
      localPath: desiredRelativePath,
      localSize: 0,
      localMtimeMs: Math.round(s.mtimeMs),
      syncedFingerprint: item.fingerprint,
      syncedAt: Date.now()
    });

    onProgress?.({ itemId: item.id, bytesDone: 0, totalBytes: 0 });
    return { finalPath: finalFullPath, localSize: 0, localMtimeMs: Math.round(s.mtimeMs) };
  }

  // 1. Verify free space
  const availableSpace = getAvailableSpace(baseFolder);
  if (availableSpace < item.size + RESERVE_BYTES) {
    throw new SyncError({
      code: 'DISK_FULL',
      message: `Insufficient free disk space to download ${item.name} (${item.size} bytes needed, reserve: 100MB)`,
      retriable: false
    });
  }

  // 2. Determine temporary file path based on item ID and fingerprint prefix
  const fpPrefix = (item.fingerprint || 'initial').slice(0, 8);
  const partPath = join(tmpDir, `${item.id}-${fpPrefix}.part`);

  if (!existsSync(tmpDir)) {
    mkdirSync(tmpDir, { recursive: true });
  }

  let existingBytes = 0;
  if (existsSync(partPath)) {
    const partStat = statSync(partPath);
    if (partStat.size < item.size) {
      existingBytes = partStat.size;
    } else if (partStat.size > item.size) {
      // Stale or larger, truncate to 0
      truncateSync(partPath, 0);
      existingBytes = 0;
    }
  }

  // 3. Open download stream from RemoteDrive
  const { stream: remoteStream, resumed } = await remoteDrive.openDownload(
    item,
    existingBytes,
    signal
  );

  // Setup hashers matching remote hashType
  const sha256 = item.hashType === 'sha256' ? createHash('sha256') : null;
  const sha1 = item.hashType === 'sha1' ? createHash('sha1') : null;
  const quickXor = item.hashType === 'quickXor' ? new QuickXorHasher() : null;

  function feedHasher(chunk: Buffer): void {
    if (sha256) sha256.update(chunk);
    if (sha1) sha1.update(chunk);
    if (quickXor) quickXor.update(chunk);
  }

  // If server responded with 200 instead of 206, discard existing bytes
  if (existingBytes > 0 && !resumed) {
    truncateSync(partPath, 0);
    existingBytes = 0;
  }

  // 4. Feed existing bytes through hasher if resuming
  if (existingBytes > 0 && resumed) {
    const existingStream = createReadStream(partPath);
    for await (const chunk of existingStream) {
      feedHasher(Buffer.from(chunk));
    }
  }

  // 5. Pipe incoming remote bytes to .part file while hashing inline
  const writeStream = createWriteStream(partPath, {
    flags: existingBytes > 0 && resumed ? 'a' : 'w'
  });

  let bytesDownloaded = existingBytes;
  let lastProgressReportTime = 0;

  const hashingTransform = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      feedHasher(chunk);
      bytesDownloaded += chunk.length;

      const now = Date.now();
      if (now - lastProgressReportTime >= 250) {
        lastProgressReportTime = now;
        onProgress?.({
          itemId: item.id,
          bytesDone: bytesDownloaded,
          totalBytes: item.size
        });
      }

      writeStream.write(chunk, callback);
    }
  });

  try {
    await pipeline(remoteStream, hashingTransform);
    writeStream.end();
  } catch (streamErr: unknown) {
    writeStream.destroy();
    const code = (streamErr as NodeJS.ErrnoException).code;
    if (code === 'ENOSPC') {
      throw new SyncError({
        code: 'DISK_FULL',
        message: `Disk full while downloading ${item.name}`,
        retriable: false,
        cause: streamErr
      });
    }
    if (code === 'ENOENT' || code === 'EIO' || code === 'ENXIO') {
      throw new SyncError({
        code: 'DRIVE_DISCONNECTED',
        message: 'External drive detached during download',
        retriable: false,
        cause: streamErr
      });
    }
    throw streamErr;
  }

  // Final progress update
  onProgress?.({ itemId: item.id, bytesDone: bytesDownloaded, totalBytes: item.size });

  // 6. Verification: Check size
  const finalPartStat = statSync(partPath);
  if (finalPartStat.size !== item.size) {
    try {
      unlinkSync(partPath);
    } catch {
      // ignore
    }
    throw new SyncError({
      code: 'SIZE_MISMATCH',
      message: `Downloaded size (${finalPartStat.size}) does not match expected size (${item.size})`,
      retriable: true
    });
  }

  // 7. Verification: Check Hash
  let computedHash = '';
  if (sha256) {
    computedHash = sha256.digest('hex');
  } else if (sha1) {
    computedHash = sha1.digest('hex');
  } else if (quickXor) {
    computedHash = quickXor.digest('base64');
  }

  if (item.fingerprint && computedHash && computedHash.toLowerCase() !== item.fingerprint.toLowerCase()) {
    logger.warn(`Hash mismatch for ${item.name}. Expected: ${item.fingerprint}, Got: ${computedHash}`);
    try {
      unlinkSync(partPath);
    } catch {
      // ignore
    }
    throw new SyncError({
      code: 'HASH_MISMATCH',
      message: `Hash verification failed for ${item.name}`,
      retriable: true
    });
  }

  // 8. Set mtime & atomically move from .part to finalPath
  if (item.remoteModified) {
    const mtime = new Date(item.remoteModified);
    try {
      utimesSync(partPath, mtime, mtime);
    } catch {
      // Some external filesystems might ignore
    }
  }

  safeMove(partPath, finalFullPath);
  const destStat = statSync(finalFullPath);

  // 9. Update DB row
  itemsRepo.updateLocalSynced(item.id, {
    localPath: desiredRelativePath,
    localSize: destStat.size,
    localMtimeMs: Math.round(destStat.mtimeMs),
    syncedFingerprint: item.fingerprint ?? computedHash,
    syncedAt: Date.now()
  });

  return {
    finalPath: finalFullPath,
    localSize: destStat.size,
    localMtimeMs: Math.round(destStat.mtimeMs)
  };
}
