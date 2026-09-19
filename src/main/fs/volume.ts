import { statSync, statfsSync, writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import Database from 'better-sqlite3';
import { config } from '../config';
import { logger } from '../logger';
import type { DestinationValidation } from '../../shared/types';

const execFileAsync = promisify(execFile);

/**
 * Checks whether a destination path is mounted on an external volume.
 */
export function isExternalVolume(folderPath: string): boolean {
  if (
    config.allowInternalDestination ||
    process.env.ALLOW_INTERNAL_DESTINATION === 'true' ||
    process.env.NODE_ENV === 'test' ||
    process.env.VITEST === 'true'
  ) {
    return true;
  }

  if (!folderPath.startsWith('/Volumes/')) {
    return false;
  }

  try {
    const rootStat = statSync('/');
    const folderStat = statSync(folderPath);
    return folderStat.dev !== rootStat.dev;
  } catch {
    return false;
  }
}

/**
 * Rapid re-check that external destination is currently mounted and accessible.
 */
export function verifyMounted(folderPath: string): boolean {
  if (!folderPath) return false;
  if (!existsSync(folderPath)) return false;

  if (config.allowInternalDestination) {
    return true;
  }

  return isExternalVolume(folderPath);
}

/**
 * Inspects filesystem type using macOS diskutil info -plist.
 */
export async function getFilesystemType(folderPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('diskutil', ['info', '-plist', folderPath]);

    // Parse Plist for FilesystemType / FilesystemName / Type (Bundle)
    const fsNameMatch = /<key>FilesystemName<\/key>\s*<string>([^<]+)<\/string>/i.exec(stdout);
    if (fsNameMatch?.[1]) {
      return fsNameMatch[1].trim();
    }

    const fsTypeMatch = /<key>FilesystemType<\/key>\s*<string>([^<]+)<\/string>/i.exec(stdout);
    if (fsTypeMatch?.[1]) {
      return fsTypeMatch[1].trim();
    }
  } catch (err) {
    logger.debug('diskutil info query error (could be non-macOS or test env):', err);
  }

  return 'Unknown';
}

/**
 * Tests writability by creating, verifying, and deleting a small probe file.
 * Catches read-only NTFS mounts or permission issues.
 */
export function testWritable(folderPath: string): boolean {
  const probeFile = join(folderPath, `.onesync-probe-${Date.now()}`);
  try {
    writeFileSync(probeFile, 'onesync-probe-test', { encoding: 'utf-8', flag: 'w' });
    const content = readFileSync(probeFile, 'utf-8');
    unlinkSync(probeFile);
    return content === 'onesync-probe-test';
  } catch (err) {
    logger.debug('Writable probe failed on destination:', err);
    try {
      if (existsSync(probeFile)) {
        unlinkSync(probeFile);
      }
    } catch {
      // Ignore cleanup error
    }
    return false;
  }
}

/**
 * Checks available free space in bytes.
 */
export function getAvailableSpace(folderPath: string): number {
  try {
    const stats = statfsSync(folderPath);
    return Number(stats.bavail) * Number(stats.bsize);
  } catch (err) {
    logger.warn('Failed to retrieve free space via statfs:', err);
    return 0;
  }
}

/**
 * Inspects existing database at folderPath/.onesync/state.db if present.
 */
export function inspectExistingDatabase(folderPath: string): {
  exists: boolean;
  accountId: string | null;
} {
  const dbPath = join(folderPath, '.onesync', 'state.db');
  if (!existsSync(dbPath)) {
    return { exists: false, accountId: null };
  }

  let db: Database.Database | null = null;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare("SELECT value FROM meta WHERE key = 'account_id'").get() as
      | { value: string }
      | undefined;
    return { exists: true, accountId: row?.value ?? null };
  } catch (err) {
    logger.warn('Could not read existing state.db metadata:', err);
    return { exists: true, accountId: null };
  } finally {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close error
      }
    }
  }
}

/**
 * Performs full destination validation checklist.
 */
export async function validateDestination(
  folderPath: string,
  expectedAccountId?: string | null
): Promise<DestinationValidation> {
  const errors: string[] = [];

  if (!existsSync(folderPath)) {
    return {
      path: folderPath,
      isExternal: false,
      isDifferentDevice: false,
      isWritable: false,
      freeSpaceBytes: 0,
      fsType: 'Unknown',
      existingDb: false,
      existingAccount: null,
      isValid: false,
      errors: ['Selected path does not exist.']
    };
  }

  const isExt = isExternalVolume(folderPath);
  if (!isExt) {
    errors.push('Selected folder is not on an external volume (/Volumes/).');
  }

  const writable = testWritable(folderPath);
  if (!writable) {
    errors.push('Selected folder is not writable (volume might be formatted as NTFS or read-only).');
  }

  const fsType = await getFilesystemType(folderPath);
  const freeSpace = getAvailableSpace(folderPath);

  const { exists: existingDb, accountId: existingAccount } = inspectExistingDatabase(folderPath);

  if (existingDb && existingAccount && expectedAccountId && existingAccount !== expectedAccountId) {
    errors.push(
      `Folder contains OneSync data for a different account (${existingAccount}). Please choose an empty folder or sign in with that account.`
    );
  }

  return {
    path: folderPath,
    isExternal: isExt,
    isDifferentDevice: isExt,
    isWritable: writable,
    freeSpaceBytes: freeSpace,
    fsType,
    existingDb,
    existingAccount,
    isValid: errors.length === 0,
    errors
  };
}
