import type { DbItem } from '../db/itemsRepo';
import type { LocalStatEntry } from './localScanner';

export type PlanActionType =
  | 'SKIP'
  | 'DOWNLOAD'
  | 'RENAME'
  | 'ADOPT'
  | 'UPDATE_LOCAL_RECORD'
  | 'CONFLICT_MOVE_THEN_DOWNLOAD'
  | 'VERIFY_THEN_ACT'
  | 'FAIL_PERMANENT';

export interface PlanSyncOptions {
  force?: boolean;
  fsType?: string;
  now?: number;
}

export interface PlanAction {
  type: PlanActionType;
  item: DbItem;
  desiredPath: string;
  oldPath?: string;
  reason?: string;
  conflictReason?: 'type_conflict' | 'local_modified' | 'untracked_conflict' | 'not_on_onedrive';
  isZeroByte?: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface LocalSnapshotItem extends LocalStatEntry {
  hash?: string | null;
}

const FOUR_GIB = 4 * 1024 * 1024 * 1024; // 4 GiB FAT32 limit

export function isHealthy(l: LocalSnapshotItem, d: DbItem): boolean {
  if (!l.exists || !l.isFile) return false;
  if (d.local_size === null || d.local_mtime_ms === null) return false;
  if (l.size !== d.local_size) return false;
  return Math.abs(l.mtimeMs - d.local_mtime_ms) <= 2000;
}

/**
 * Pure planning function evaluating the 10-row decision matrix.
 */
export function planSyncItem(
  item: DbItem,
  desiredPath: string,
  localItem: LocalSnapshotItem | undefined,
  oldLocalItem: LocalSnapshotItem | undefined,
  options: PlanSyncOptions = {}
): PlanAction {
  const now = options.now ?? Date.now();
  const fsType = options.fsType?.toUpperCase() ?? '';

  // Filesystem FAT32 limit check
  if (fsType === 'FAT32' && item.size >= FOUR_GIB) {
    return {
      type: 'FAIL_PERMANENT',
      item,
      desiredPath,
      errorCode: 'FS_LIMIT',
      errorMessage: 'File size exceeds 4 GiB limit on FAT32 volumes. Format drive as APFS or exFAT.'
    };
  }

  const fingerprint = item.fingerprint;
  const syncedFingerprint = item.synced_fingerprint;
  const isZeroByte = item.size === 0;

  // 1. status = failed_permanent and fingerprint unchanged -> SKIP
  if (item.status === 'failed_permanent' && fingerprint === syncedFingerprint) {
    return {
      type: 'SKIP',
      item,
      desiredPath,
      reason: 'failed_permanent'
    };
  }

  // 2. status = failed, next_retry_at in the future, run is not forced -> SKIP
  if (
    item.status === 'failed' &&
    item.next_retry_at &&
    item.next_retry_at > now &&
    !options.force
  ) {
    return {
      type: 'SKIP',
      item,
      desiredPath,
      reason: 'waiting_retry'
    };
  }

  // 3. D.local_path != P, old file exists & healthy, fingerprint unchanged -> RENAME
  if (
    item.local_path &&
    item.local_path !== desiredPath &&
    oldLocalItem &&
    isHealthy(oldLocalItem, item) &&
    fingerprint === syncedFingerprint
  ) {
    return {
      type: 'RENAME',
      item,
      desiredPath,
      oldPath: item.local_path
    };
  }

  // If local item does not exist at desired path
  if (!localItem || !localItem.exists) {
    // 5. L missing -> DOWNLOAD
    return {
      type: 'DOWNLOAD',
      item,
      desiredPath,
      isZeroByte
    };
  }

  // 4. P is a directory on disk (wrong type conflict)
  if (localItem.isDirectory) {
    return {
      type: 'CONFLICT_MOVE_THEN_DOWNLOAD',
      item,
      desiredPath,
      conflictReason: 'type_conflict',
      isZeroByte
    };
  }

  const hasDbRecord = item.status === 'synced' && item.local_path !== null;
  const fingerprintUnchanged = fingerprint !== null && fingerprint === syncedFingerprint;

  // 10. L exists but NO DB record (DB lost/corrupt, or user copied files in)
  if (!hasDbRecord) {
    if (localItem.hash) {
      const match =
        (item.fingerprint && localItem.hash === item.fingerprint) ||
        (!item.hash_type && localItem.size === item.size);
      if (match) {
        return {
          type: 'ADOPT',
          item,
          desiredPath
        };
      }
      return {
        type: 'CONFLICT_MOVE_THEN_DOWNLOAD',
        item,
        desiredPath,
        conflictReason: 'untracked_conflict',
        isZeroByte
      };
    }
    // Need hash verification before adopting
    return {
      type: 'VERIFY_THEN_ACT',
      item,
      desiredPath,
      conflictReason: 'untracked_conflict',
      isZeroByte
    };
  }

  // 6. L exists, fingerprint unchanged, healthy -> SKIP
  if (fingerprintUnchanged && isHealthy(localItem, item)) {
    return {
      type: 'SKIP',
      item,
      desiredPath,
      reason: 'healthy'
    };
  }

  // 7. L exists, fingerprint unchanged, size ok but mtime differs
  if (fingerprintUnchanged && localItem.size === item.size) {
    if (localItem.hash) {
      if (localItem.hash === item.fingerprint) {
        return {
          type: 'UPDATE_LOCAL_RECORD',
          item,
          desiredPath
        };
      }
      // Mismatch -> treat as user-modified
      return {
        type: 'CONFLICT_MOVE_THEN_DOWNLOAD',
        item,
        desiredPath,
        conflictReason: 'local_modified',
        isZeroByte
      };
    }
    return {
      type: 'VERIFY_THEN_ACT',
      item,
      desiredPath,
      conflictReason: 'local_modified',
      isZeroByte
    };
  }

  // 8. L exists, fingerprint changed, L matches D (untouched by user) -> DOWNLOAD
  if (!fingerprintUnchanged && isHealthy(localItem, item)) {
    return {
      type: 'DOWNLOAD',
      item,
      desiredPath,
      isZeroByte
    };
  }

  // 9. L exists, fingerprint unchanged but size/hash differs, OR fingerprint changed and L differs from D
  return {
    type: 'CONFLICT_MOVE_THEN_DOWNLOAD',
    item,
    desiredPath,
    conflictReason: 'local_modified',
    isZeroByte
  };
}

/**
 * Pure batch planner mapping all remote files against local stat snapshots.
 */
export function planSync(
  items: DbItem[],
  pathMap: Map<string, string>,
  localSnapshot: Map<string, LocalSnapshotItem>,
  options: PlanSyncOptions = {}
): PlanAction[] {
  const actions: PlanAction[] = [];

  for (const item of items) {
    if (item.is_folder) {
      continue;
    }

    const desiredPath = pathMap.get(item.id) ?? item.name;
    const localItem = localSnapshot.get(desiredPath);
    const oldLocalItem = item.local_path ? localSnapshot.get(item.local_path) : undefined;

    actions.push(planSyncItem(item, desiredPath, localItem, oldLocalItem, options));
  }

  return actions;
}
