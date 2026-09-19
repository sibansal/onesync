import { opendir, rmdir } from 'fs/promises';
import { join } from 'path';
import { existsSync, statSync } from 'fs';
import { moveToRestored } from '../fs/safeMove';
import type { RestoredLogRepo } from '../db/logRepo';
import { logger } from '../logger';
import { probeFileReadable } from './localScanner';

const IGNORED_NAMES = new Set([
  '.DS_Store',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  'Thumbs.db',
  'desktop.ini',
]);

function isIgnored(name: string): boolean {
  if (IGNORED_NAMES.has(name)) return true;
  if (name.startsWith('._')) return true; // AppleDouble resource forks
  return false;
}

import type { ItemsRepo } from '../db/itemsRepo';

export interface CloudItemSummary {
  id: string;
  desiredPath: string;
  size: number;
  fingerprint: string | null;
}

export interface SweepOptions {
  baseFolder: string;
  expectedPaths: Set<string>;
  expectedFolderPaths?: Set<string>;
  restoredLogRepo: RestoredLogRepo;
  gatingAllowed: boolean;
  onFileRestored?: (originalRelPath: string, restoredRelPath: string) => void;
  itemsRepo?: ItemsRepo;
  cloudItems?: Map<string, CloudItemSummary>;
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
    onFileRestored,
    itemsRepo,
    cloudItems,
  } = options;

  if (!gatingAllowed) {
    logger.warn('Sweep bypassed because discovery did not complete cleanly or was cancelled.');
    return { movedCount: 0 };
  }

  const lowerExpectedPaths = new Map<string, string>();
  for (const p of expectedPaths) {
    lowerExpectedPaths.set(p.toLowerCase(), p);
  }
  const lowerExpectedFolderPaths = new Map<string, string>();
  for (const p of expectedFolderPaths) {
    lowerExpectedFolderPaths.set(p.toLowerCase(), p);
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
        const isExpectedFolder =
          expectedFolderPaths.has(normalizedRelPath) ||
          lowerExpectedFolderPaths.has(normalizedRelPath.toLowerCase());
        if (!subHasChildren && !isExpectedFolder) {
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
        const isExpectedFile =
          expectedPaths.has(normalizedRelPath) ||
          lowerExpectedPaths.has(normalizedRelPath.toLowerCase());

        if (isExpectedFile) {
          hasRemainingChildren = true;
        } else {
          // Check if file is equivalent to an existing OneDrive cloud item
          let isEquivalentToCloud = false;
          if (cloudItems) {
            const matchedItem = cloudItems.get(normalizedRelPath.toLowerCase());
            if (matchedItem) {
              try {
                const s = statSync(childFullPath);
                const hasAllocatedBlocks =
                  matchedItem.size === 0 || s.blocks === undefined || s.blocks > 0;
                if (
                  s.size === matchedItem.size &&
                  hasAllocatedBlocks &&
                  probeFileReadable(childFullPath, matchedItem.size)
                ) {
                  isEquivalentToCloud = true;
                  if (itemsRepo) {
                    itemsRepo.updateLocalSynced(matchedItem.id, {
                      localPath: matchedItem.desiredPath,
                      localSize: s.size,
                      localMtimeMs: Math.round(s.mtimeMs),
                      syncedFingerprint: matchedItem.fingerprint,
                      syncedAt: Date.now(),
                    });
                  }
                  logger.info(
                    `Preserved equivalent existing file ${childRelPath} (matches OneDrive ${matchedItem.desiredPath})`,
                  );
                }
              } catch {
                // ignore stat error
              }
            }
          }

          if (isEquivalentToCloud) {
            hasRemainingChildren = true;
          } else {
            // Unmapped file -> move to restored/
            try {
              const restoredRel = moveToRestored({
                baseFolder,
                sourceFullPath: childFullPath,
                relativePath: childRelPath,
              });

              restoredLogRepo.log(childRelPath, restoredRel, 'not_on_onedrive');
              onFileRestored?.(childRelPath, restoredRel);
              movedCount++;
            } catch (moveErr) {
              logger.error(`Failed to move orphan ${childRelPath} to restored/:`, moveErr);
              hasRemainingChildren = true;
            }
          }
        }
      }
    }

    return hasRemainingChildren;
  }

  await walkDir('');
  return { movedCount };
}
