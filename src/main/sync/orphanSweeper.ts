import { opendir, rmdir } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { moveToRestored } from '../fs/safeMove';
import type { RestoredLogRepo } from '../db/logRepo';
import { logger } from '../logger';

const IGNORED_NAMES = new Set([
  '.DS_Store',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  'Thumbs.db',
  'desktop.ini'
]);

function isIgnored(name: string): boolean {
  if (IGNORED_NAMES.has(name)) return true;
  if (name.startsWith('._')) return true; // AppleDouble resource forks
  return false;
}

export interface SweepOptions {
  baseFolder: string;
  expectedPaths: Set<string>;
  expectedFolderPaths?: Set<string>;
  restoredLogRepo: RestoredLogRepo;
  gatingAllowed: boolean;
  onFileRestored?: (originalRelPath: string, restoredRelPath: string) => void;
}

/**
 * Streams through onedrive/ with opendir, moving any unmapped file into restored/
 * and pruning obsolete empty directories.
 */
export async function sweepOrphans(options: SweepOptions): Promise<{ movedCount: number }> {
  const {
    baseFolder,
    expectedPaths,
    expectedFolderPaths = new Set<string>(),
    restoredLogRepo,
    gatingAllowed,
    onFileRestored
  } = options;

  if (!gatingAllowed) {
    logger.warn('Sweep bypassed because discovery did not complete cleanly or was cancelled.');
    return { movedCount: 0 };
  }

  const onedriveRoot = join(baseFolder, 'onedrive');
  if (!existsSync(onedriveRoot)) {
    return { movedCount: 0 };
  }

  let movedCount = 0;

  async function walkDir(currentRelDir: string): Promise<boolean> {
    const fullDirPath = join(onedriveRoot, currentRelDir);
    let dirHandle;
    try {
      dirHandle = await opendir(fullDirPath);
    } catch {
      return false;
    }

    let hasRemainingChildren = false;

    for await (const dirent of dirHandle) {
      const name = dirent.name;
      if (isIgnored(name)) {
        continue;
      }

      const childRelPath = currentRelDir ? `${currentRelDir}/${name}` : name;
      const normalizedRelPath = childRelPath.normalize('NFC');
      const childFullPath = join(onedriveRoot, childRelPath);

      if (dirent.isDirectory()) {
        const subHasChildren = await walkDir(childRelPath);
        if (!subHasChildren && !expectedFolderPaths.has(normalizedRelPath)) {
          // Empty directory not mapped to any remote folder -> prune
          try {
            await rmdir(childFullPath);
          } catch {
            hasRemainingChildren = true;
          }
        } else {
          hasRemainingChildren = true;
        }
      } else if (dirent.isFile() || dirent.isSymbolicLink()) {
        if (!expectedPaths.has(normalizedRelPath)) {
          // Unmapped file -> move to restored/
          try {
            const restoredRel = moveToRestored({
              baseFolder,
              sourceFullPath: childFullPath,
              relativePath: childRelPath
            });

            restoredLogRepo.log(childRelPath, restoredRel, 'not_on_onedrive');
            onFileRestored?.(childRelPath, restoredRel);
            movedCount++;
          } catch (moveErr) {
            logger.error(`Failed to move orphan ${childRelPath} to restored/:`, moveErr);
            hasRemainingChildren = true;
          }
        } else {
          hasRemainingChildren = true;
        }
      }
    }

    return hasRemainingChildren;
  }

  await walkDir('');
  return { movedCount };
}
