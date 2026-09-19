import { join } from 'path';
import { existsSync, statSync } from 'fs';
import type { PlanAction } from './planner';
import type { RemoteDrive } from '../onedrive/remoteDrive';
import type { ItemsRepo } from '../db/itemsRepo';
import type { RestoredLogRepo } from '../db/logRepo';
import { downloadFile, type DownloadProgressUpdate } from './downloader';
import { moveToRestored, safeMove } from '../fs/safeMove';
import { computeLocalFileHash } from './localScanner';
import { mapConcurrent } from '../utils/pool';
import { withRetry } from '../utils/retry';
import { SyncError } from '../utils/errors';
import { config } from '../config';
import type { ActiveDownload } from '../../shared/types';
import { logger } from '../logger';

export interface ExecutorProgressPayload {
  filesDone: number;
  totalFiles: number;
  bytesDone: number;
  totalBytes: number;
  speedBytesPerSec: number;
  activeDownloads: ActiveDownload[];
  downloadedCount: number;
  upToDateCount: number;
  restoredCount: number;
  failedCount: number;
}

export interface ExecutorOptions {
  baseFolder: string;
  remoteDrive: RemoteDrive;
  itemsRepo: ItemsRepo;
  restoredLogRepo: RestoredLogRepo;
  concurrency?: number;
  onProgress?: (progress: ExecutorProgressPayload) => void;
  signal?: AbortSignal;
  checkPause?: () => Promise<void>;
}

export interface ExecutorResult {
  downloaded: number;
  skipped: number;
  restored: number;
  failed: number;
  bytes: number;
}

export async function executePlan(
  actions: PlanAction[],
  options: ExecutorOptions,
): Promise<ExecutorResult> {
  const {
    baseFolder,
    remoteDrive,
    itemsRepo,
    restoredLogRepo,
    concurrency = config.syncConcurrency,
    onProgress,
    signal,
  } = options;

  const onedriveRoot = join(baseFolder, 'onedrive');

  // Small files first: sort by size ascending
  const sortedActions = [...actions].sort((a, b) => a.item.size - b.item.size);

  let downloadedCount = 0;
  let upToDateCount = 0;
  let restoredCount = 0;
  let failedCount = 0;
  let totalBytesDone = 0;

  const totalFiles = sortedActions.length;
  let filesDone = 0;

  const activeDownloadsMap = new Map<string, ActiveDownload>();
  const speedHistory: Array<{ timestamp: number; bytes: number }> = [];

  function reportProgress(): void {
    const now = Date.now();
    speedHistory.push({ timestamp: now, bytes: totalBytesDone });

    // Prune speed history older than 3 seconds
    while (speedHistory.length > 0 && now - (speedHistory[0]?.timestamp ?? 0) > 3000) {
      speedHistory.shift();
    }

    let speed = 0;
    if (speedHistory.length >= 2) {
      const oldest = speedHistory[0]!;
      const newest = speedHistory[speedHistory.length - 1]!;
      const timeDiff = (newest.timestamp - oldest.timestamp) / 1000;
      if (timeDiff > 0.1) {
        speed = Math.max(0, (newest.bytes - oldest.bytes) / timeDiff);
      }
    }

    // Limit active downloads displayed to at most 8
    const activeList = Array.from(activeDownloadsMap.values()).slice(0, 8);

    onProgress?.({
      filesDone,
      totalFiles,
      bytesDone: totalBytesDone,
      totalBytes: sortedActions.reduce((acc, a) => acc + (a.item.size || 0), 0),
      speedBytesPerSec: Math.round(speed),
      activeDownloads: activeList,
      downloadedCount,
      upToDateCount,
      restoredCount,
      failedCount,
    });
  }

  await mapConcurrent(
    sortedActions,
    async (action) => {
      if (signal?.aborted) {
        return;
      }

      if (options.checkPause) {
        await options.checkPause();
      }

      if (signal?.aborted) {
        return;
      }

      const { item, desiredPath } = action;
      const targetFullPath = join(onedriveRoot, desiredPath);

      try {
        switch (action.type) {
          case 'SKIP':
            upToDateCount++;
            filesDone++;
            reportProgress();
            break;

          case 'FAIL_PERMANENT':
            itemsRepo.markFailedPermanent(item.id, {
              errorCode: action.errorCode || 'FS_LIMIT',
              errorMessage: action.errorMessage || 'Permanent failure',
            });
            failedCount++;
            filesDone++;
            reportProgress();
            break;

          case 'RENAME': {
            if (action.oldPath) {
              const oldFullPath = join(onedriveRoot, action.oldPath);
              if (existsSync(oldFullPath)) {
                safeMove(oldFullPath, targetFullPath);
                itemsRepo.updateLocalRenamed(item.id, desiredPath);
              }
            }
            filesDone++;
            reportProgress();
            break;
          }

          case 'ADOPT': {
            if (existsSync(targetFullPath)) {
              const s = statSync(targetFullPath);
              itemsRepo.updateLocalSynced(item.id, {
                localPath: desiredPath,
                localSize: s.size,
                localMtimeMs: Math.round(s.mtimeMs),
                syncedFingerprint: item.fingerprint,
                syncedAt: Date.now(),
              });
            }
            upToDateCount++;
            filesDone++;
            reportProgress();
            break;
          }

          case 'UPDATE_LOCAL_RECORD': {
            if (existsSync(targetFullPath)) {
              const s = statSync(targetFullPath);
              itemsRepo.updateLocalSynced(item.id, {
                localPath: desiredPath,
                localSize: s.size,
                localMtimeMs: Math.round(s.mtimeMs),
                syncedFingerprint: item.fingerprint,
                syncedAt: Date.now(),
              });
            }
            upToDateCount++;
            filesDone++;
            reportProgress();
            break;
          }

          case 'VERIFY_THEN_ACT': {
            // Compute hash of local file
            const localHash = await computeLocalFileHash(targetFullPath, item.hash_type);
            const isMatch =
              (item.fingerprint && localHash === item.fingerprint) ||
              (!item.hash_type && statSync(targetFullPath).size === item.size);

            if (isMatch) {
              const s = statSync(targetFullPath);
              itemsRepo.updateLocalSynced(item.id, {
                localPath: desiredPath,
                localSize: s.size,
                localMtimeMs: Math.round(s.mtimeMs),
                syncedFingerprint: item.fingerprint,
                syncedAt: Date.now(),
              });
              upToDateCount++;
              filesDone++;
              reportProgress();
            } else {
              // Mismatch -> move to restored/ then download
              const restoredRel = moveToRestored({
                baseFolder,
                sourceFullPath: targetFullPath,
                relativePath: desiredPath,
              });
              restoredLogRepo.log(
                desiredPath,
                restoredRel,
                action.conflictReason || 'local_modified',
              );
              restoredCount++;

              // Proceed to download
              await performDownload();
            }
            break;
          }

          case 'CONFLICT_MOVE_THEN_DOWNLOAD': {
            if (existsSync(targetFullPath)) {
              const restoredRel = moveToRestored({
                baseFolder,
                sourceFullPath: targetFullPath,
                relativePath: desiredPath,
              });
              restoredLogRepo.log(
                desiredPath,
                restoredRel,
                action.conflictReason || 'local_modified',
              );
              restoredCount++;
            }
            await performDownload();
            break;
          }

          case 'DOWNLOAD': {
            await performDownload();
            break;
          }
        }
      } catch (itemErr: unknown) {
        activeDownloadsMap.delete(item.id);

        if (
          signal?.aborted ||
          (SyncError.isSyncError(itemErr) && itemErr.code === 'CANCELLED') ||
          (itemErr instanceof Error &&
            (itemErr.name === 'AbortError' || itemErr.message.toLowerCase().includes('cancelled')))
        ) {
          reportProgress();
          return;
        }

        logger.error(`Error processing action for ${item.name}:`, itemErr);

        if (SyncError.isSyncError(itemErr)) {
          if (itemErr.code === 'DISK_FULL' || itemErr.code === 'DRIVE_DISCONNECTED') {
            // Run-level error -> propagate upwards to halt run
            throw itemErr;
          }

          if (!itemErr.retriable) {
            itemsRepo.markFailedPermanent(item.id, {
              errorCode: itemErr.code,
              errorMessage: itemErr.message,
            });
          } else {
            // Cross-run retry schedule: 5min * 2^retry_count, capped at 24h
            const nextRetryDelay = Math.min(
              5 * 60 * 1000 * Math.pow(2, item.retry_count),
              24 * 3600 * 1000,
            );
            itemsRepo.markFailed(item.id, {
              errorCode: itemErr.code,
              errorMessage: itemErr.message,
              nextRetryAt: Date.now() + nextRetryDelay,
            });
          }
        } else {
          itemsRepo.markFailed(item.id, {
            errorCode: 'UNKNOWN',
            errorMessage: itemErr instanceof Error ? itemErr.message : String(itemErr),
            nextRetryAt: Date.now() + 5 * 60 * 1000,
          });
        }

        failedCount++;
        filesDone++;
        reportProgress();
      }

      async function performDownload(): Promise<void> {
        let lastReportedBytes = 0;
        activeDownloadsMap.set(item.id, {
          id: item.id,
          name: item.name,
          bytesDone: 0,
          totalBytes: item.size,
        });

        try {
          await withRetry(
            async () => {
              if (signal?.aborted) {
                throw new SyncError({
                  code: 'CANCELLED',
                  message: 'Sync was cancelled by user',
                  retriable: false,
                });
              }

              if (options.checkPause) {
                await options.checkPause();
              }

              if (signal?.aborted) {
                throw new SyncError({
                  code: 'CANCELLED',
                  message: 'Sync was cancelled by user',
                  retriable: false,
                });
              }

              return downloadFile(
                {
                  id: item.id,
                  parentId: item.parent_id,
                  name: item.name,
                  isFolder: Boolean(item.is_folder),
                  size: item.size,
                  fingerprint: item.fingerprint,
                  hashType: item.hash_type,
                  remoteModified: item.remote_modified,
                },
                desiredPath,
                {
                  baseFolder,
                  remoteDrive,
                  itemsRepo,
                  signal,
                  onProgress: (update: DownloadProgressUpdate) => {
                    const delta = update.bytesDone - lastReportedBytes;
                    lastReportedBytes = update.bytesDone;
                    totalBytesDone += delta;

                    activeDownloadsMap.set(item.id, {
                      id: item.id,
                      name: item.name,
                      bytesDone: update.bytesDone,
                      totalBytes: update.totalBytes,
                    });
                    reportProgress();
                  },
                },
              );
            },
            {
              maxRetries: config.maxRetries,
              baseDelayMs: config.retryBaseDelayMs,
            },
          );

          downloadedCount++;
          filesDone++;
        } finally {
          activeDownloadsMap.delete(item.id);
          reportProgress();
        }
      }
    },
    { concurrency, signal },
  );

  return {
    downloaded: downloadedCount,
    skipped: upToDateCount,
    restored: restoredCount,
    failed: failedCount,
    bytes: totalBytesDone,
  };
}
