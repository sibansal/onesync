import { describe, it, expect } from 'vitest';
import { planSyncItem, type LocalSnapshotItem } from '../src/main/sync/planner';
import type { DbItem } from '../src/main/db/itemsRepo';

function createMockDbItem(overrides: Partial<DbItem> = {}): DbItem {
  return {
    id: 'item_1',
    parent_id: null,
    name: 'test.pdf',
    is_folder: 0,
    size: 1000,
    fingerprint: 'fp_v1',
    hash_type: 'sha256',
    remote_modified: '2026-09-19T00:00:00Z',
    seen_run: 1,
    local_path: 'test.pdf',
    local_size: 1000,
    local_mtime_ms: 1700000000000,
    synced_fingerprint: 'fp_v1',
    status: 'synced',
    error_code: null,
    error_message: null,
    retry_count: 0,
    next_retry_at: null,
    synced_at: 1700000000000,
    ...overrides,
  };
}

function createLocalSnapshot(overrides: Partial<LocalSnapshotItem> = {}): LocalSnapshotItem {
  return {
    relativePath: 'test.pdf',
    fullPath: '/Volumes/Drive/onedrive/test.pdf',
    exists: true,
    isFile: true,
    isDirectory: false,
    size: 1000,
    mtimeMs: 1700000000000,
    ...overrides,
  };
}

describe('Planner - 10-Row Decision Matrix', () => {
  it('Row 1: status = failed_permanent and fingerprint unchanged -> SKIP', () => {
    const item = createMockDbItem({ status: 'failed_permanent' });
    const local = createLocalSnapshot({ exists: false });
    const action = planSyncItem(item, 'test.pdf', local, undefined);
    expect(action.type).toBe('SKIP');
    expect(action.reason).toBe('failed_permanent');
  });

  it('Row 2: status = failed, next_retry_at in future, not forced -> SKIP; forced -> continues', () => {
    const item = createMockDbItem({
      status: 'failed',
      next_retry_at: 1000000,
    });
    const local = createLocalSnapshot({ exists: false });

    const waitingAction = planSyncItem(item, 'test.pdf', local, undefined, {
      now: 500000,
      force: false,
    });
    expect(waitingAction.type).toBe('SKIP');
    expect(waitingAction.reason).toBe('waiting_retry');

    const forcedAction = planSyncItem(item, 'test.pdf', local, undefined, {
      now: 500000,
      force: true,
    });
    expect(forcedAction.type).toBe('DOWNLOAD');
  });

  it('Row 3: D.local_path != P, old file exists & healthy, fingerprint unchanged -> RENAME', () => {
    const item = createMockDbItem({
      local_path: 'OldFolder/test.pdf',
    });
    const oldLocal = createLocalSnapshot({
      relativePath: 'OldFolder/test.pdf',
      exists: true,
      isFile: true,
      size: 1000,
      mtimeMs: 1700000000000,
    });
    const action = planSyncItem(item, 'NewFolder/test.pdf', undefined, oldLocal);
    expect(action.type).toBe('RENAME');
    expect(action.oldPath).toBe('OldFolder/test.pdf');
    expect(action.desiredPath).toBe('NewFolder/test.pdf');
  });

  it('Row 4: P is a directory on disk -> CONFLICT_MOVE (type_conflict) then DOWNLOAD', () => {
    const item = createMockDbItem();
    const local = createLocalSnapshot({ isDirectory: true, isFile: false });
    const action = planSyncItem(item, 'test.pdf', local, undefined);
    expect(action.type).toBe('CONFLICT_MOVE_THEN_DOWNLOAD');
    expect(action.conflictReason).toBe('type_conflict');
  });

  it('Row 5: L missing -> DOWNLOAD', () => {
    const item = createMockDbItem();
    const local = createLocalSnapshot({ exists: false });
    const action = planSyncItem(item, 'test.pdf', local, undefined);
    expect(action.type).toBe('DOWNLOAD');
  });

  it('Row 6: L exists, fingerprint unchanged, healthy -> SKIP', () => {
    const item = createMockDbItem();
    const local = createLocalSnapshot({ mtimeMs: 1700000001000 }); // within 2s tolerance
    const action = planSyncItem(item, 'test.pdf', local, undefined);
    expect(action.type).toBe('SKIP');
    expect(action.reason).toBe('healthy');
  });

  it('Row 7: L exists, fingerprint unchanged, size matches, mtime differs -> UPDATE_LOCAL_RECORD on hash match', () => {
    const item = createMockDbItem({ fingerprint: 'hash_abc', synced_fingerprint: 'hash_abc' });
    const local = createLocalSnapshot({
      mtimeMs: 1700050000000, // beyond 2s tolerance
      hash: 'hash_abc',
    });
    const action = planSyncItem(item, 'test.pdf', local, undefined);
    expect(action.type).toBe('UPDATE_LOCAL_RECORD');
  });

  it('Row 7: L exists, fingerprint unchanged, size matches, mtime differs -> CONFLICT_MOVE on hash mismatch', () => {
    const item = createMockDbItem({ fingerprint: 'hash_abc', synced_fingerprint: 'hash_abc' });
    const local = createLocalSnapshot({
      mtimeMs: 1700050000000,
      hash: 'hash_different',
    });
    const action = planSyncItem(item, 'test.pdf', local, undefined);
    expect(action.type).toBe('CONFLICT_MOVE_THEN_DOWNLOAD');
    expect(action.conflictReason).toBe('local_modified');
  });

  it('Row 8: L exists, fingerprint changed, L matches D (untouched locally) -> DOWNLOAD', () => {
    const item = createMockDbItem({
      fingerprint: 'fp_v2', // cloud modified
      synced_fingerprint: 'fp_v1',
      local_size: 1000,
      local_mtime_ms: 1700000000000,
    });
    const local = createLocalSnapshot({ size: 1000, mtimeMs: 1700000000000 });
    const action = planSyncItem(item, 'test.pdf', local, undefined);
    expect(action.type).toBe('DOWNLOAD');
  });

  it('Row 9: L exists, fingerprint changed and L differs from D -> CONFLICT_MOVE (local_modified)', () => {
    const item = createMockDbItem({
      fingerprint: 'fp_v2',
      synced_fingerprint: 'fp_v1',
      local_size: 1000,
      local_mtime_ms: 1700000000000,
    });
    const local = createLocalSnapshot({ size: 1500, mtimeMs: 1700000005000 }); // user modified locally
    const action = planSyncItem(item, 'test.pdf', local, undefined);
    expect(action.type).toBe('CONFLICT_MOVE_THEN_DOWNLOAD');
    expect(action.conflictReason).toBe('local_modified');
  });

  it('Row 10: L exists but no DB record -> SKIP on healthy; CONFLICT_MOVE on mismatch', () => {
    const item = createMockDbItem({
      status: 'pending',
      local_path: null,
      size: 500,
      fingerprint: 'hash_xyz',
    });

    // Available file in dir is healthy (matching size) -> mark as SKIP
    const healthyLocal = createLocalSnapshot({ size: 500 });
    const skipAction = planSyncItem(item, 'test.pdf', healthyLocal, undefined);
    expect(skipAction.type).toBe('SKIP');
    expect(skipAction.reason).toBe('healthy');

    // Mismatched hash or size -> CONFLICT_MOVE_THEN_DOWNLOAD
    const mismatchHashLocal = createLocalSnapshot({ size: 500, hash: 'hash_other' });
    const conflictHashAction = planSyncItem(item, 'test.pdf', mismatchHashLocal, undefined);
    expect(conflictHashAction.type).toBe('CONFLICT_MOVE_THEN_DOWNLOAD');
    expect(conflictHashAction.conflictReason).toBe('untracked_conflict');

    const mismatchSizeLocal = createLocalSnapshot({ size: 999 });
    const conflictSizeAction = planSyncItem(item, 'test.pdf', mismatchSizeLocal, undefined);
    expect(conflictSizeAction.type).toBe('CONFLICT_MOVE_THEN_DOWNLOAD');
    expect(conflictSizeAction.conflictReason).toBe('untracked_conflict');
  });

  it('zero-byte files are flagged as isZeroByte without network requirement', () => {
    const item = createMockDbItem({ size: 0 });
    const local = createLocalSnapshot({ exists: false });
    const action = planSyncItem(item, 'empty.txt', local, undefined);
    expect(action.type).toBe('DOWNLOAD');
    expect(action.isZeroByte).toBe(true);
  });

  it('fails files >= 4 GiB permanently on FAT32 filesystems', () => {
    const item = createMockDbItem({ size: 5 * 1024 * 1024 * 1024 });
    const local = createLocalSnapshot({ exists: false });
    const action = planSyncItem(item, 'huge.iso', local, undefined, { fsType: 'FAT32' });
    expect(action.type).toBe('FAIL_PERMANENT');
    expect(action.errorCode).toBe('FS_LIMIT');
  });
});
