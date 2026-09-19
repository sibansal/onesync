import { dirname, join, extname } from 'path';
import { existsSync, mkdirSync, renameSync, copyFileSync, unlinkSync } from 'fs';

/**
 * Moves a file atomically using renameSync, with a fallback to copy+unlink
 * if an EXDEV (cross-device) boundary is encountered.
 */
export function safeMove(sourcePath: string, destPath: string): void {
  const destDir = dirname(destPath);
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }

  try {
    renameSync(sourcePath, destPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      copyFileSync(sourcePath, destPath);
      unlinkSync(sourcePath);
    } else {
      throw err;
    }
  }
}

function formatRestoredTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const YYYY = date.getFullYear();
  const MM = pad(date.getMonth() + 1);
  const DD = pad(date.getDate());
  const HH = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  return `${YYYY}-${MM}-${DD} ${HH}${mm}${ss}`;
}

/**
 * Computes a non-colliding destination path inside <baseFolder>/restored/
 * Appending ` (restored YYYY-MM-DD HHmmss)` before the extension if a collision occurs.
 */
export function getRestoredDestinationPath(baseFolder: string, relativePath: string): string {
  const targetDir = join(baseFolder, 'restored', dirname(relativePath));
  const ext = extname(relativePath);
  const baseName = relativePath.slice(dirname(relativePath) === '.' ? 0 : dirname(relativePath).length + 1);
  const nameWithoutExt = baseName.slice(0, baseName.length - ext.length);

  const initialPath = join(baseFolder, 'restored', relativePath);
  if (!existsSync(initialPath)) {
    return initialPath;
  }

  // Handle collision
  const timestamp = formatRestoredTimestamp();
  let candidate = join(targetDir, `${nameWithoutExt} (restored ${timestamp})${ext}`);
  let counter = 2;

  while (existsSync(candidate)) {
    candidate = join(targetDir, `${nameWithoutExt} (restored ${timestamp}-${counter})${ext}`);
    counter++;
  }

  return candidate;
}

/**
 * Safely moves an orphan, untracked, or modified file into the restored/ directory,
 * returning the relative path within restored/.
 */
export function moveToRestored(options: {
  baseFolder: string;
  sourceFullPath: string;
  relativePath: string;
}): string {
  const { baseFolder, sourceFullPath, relativePath } = options;
  const destFullPath = getRestoredDestinationPath(baseFolder, relativePath);

  safeMove(sourceFullPath, destFullPath);

  // Return path relative to baseFolder/restored/
  const restoredRoot = join(baseFolder, 'restored');
  let rel = destFullPath.slice(restoredRoot.length);
  if (rel.startsWith('/')) {
    rel = rel.slice(1);
  }
  return rel;
}
