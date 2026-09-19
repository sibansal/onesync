import { extname } from 'path';

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_REGEX = /[\x00-\x1f\x7f]/g;
const ILLEGAL_CHARS_REGEX = /[:*?"<>|\\/]/g;

/**
 * Sanitizes a single filename or directory segment for external filesystems.
 * - Strips control characters
 * - Replaces invalid chars (: * ? " < > | \ /) with _
 * - Trims trailing dots and spaces
 * - Normalizes to Unicode NFC
 * - Caps at 255 bytes while preserving extension
 */
export function sanitizeSegment(segment: string): string {
  if (!segment) return 'unnamed';

  // 1. Normalize to NFC
  let cleaned = segment.normalize('NFC');

  // 2. Strip control characters
  cleaned = cleaned.replace(CONTROL_CHARS_REGEX, '');

  // 3. Replace invalid chars with underscore
  cleaned = cleaned.replace(ILLEGAL_CHARS_REGEX, '_');

  // 4. Trim trailing dots and spaces
  cleaned = cleaned.replace(/[. ]+$/, '');

  if (cleaned.length === 0) {
    cleaned = 'unnamed';
  }

  // 4. Cap at 255 bytes while preserving extension
  const maxBytes = 255;
  if (Buffer.byteLength(cleaned, 'utf8') <= maxBytes) {
    return cleaned;
  }

  const ext = extname(cleaned);
  const extBytes = Buffer.byteLength(ext, 'utf8');

  // If extension itself is somehow excessively large
  if (extBytes >= maxBytes - 10) {
    let truncated = cleaned;
    while (Buffer.byteLength(truncated, 'utf8') > maxBytes && truncated.length > 0) {
      truncated = truncated.slice(0, -1);
    }
    return truncated || 'unnamed';
  }

  let base = cleaned.slice(0, cleaned.length - ext.length);
  while (Buffer.byteLength(base, 'utf8') + extBytes > maxBytes && base.length > 0) {
    base = base.slice(0, -1);
  }
  // Trim any trailing dots or spaces from base after truncation
  base = base.replace(/[. ]+$/, '');

  return (base || 'unnamed') + ext;
}

export interface PathItemReference {
  id: string;
  name: string;
  parentId: string | null;
  isFolder?: boolean;
}

/**
 * Walks parentId references up to the root to calculate raw relative path segments.
 */
export function computeRelativePath(
  item: PathItemReference,
  itemMap: Map<string, PathItemReference>,
): string {
  const segments: string[] = [sanitizeSegment(item.name)];
  let currentParentId = item.parentId;
  const visited = new Set<string>([item.id]);

  while (currentParentId) {
    if (visited.has(currentParentId)) {
      // Cycle detected
      break;
    }
    visited.add(currentParentId);

    const parent = itemMap.get(currentParentId);
    if (!parent) {
      // Reached root or unknown parent
      break;
    }

    // Root items usually have no name or root property; don't prepend empty or root names
    if (parent.parentId !== null && parent.name) {
      segments.unshift(sanitizeSegment(parent.name));
    }
    currentParentId = parent.parentId;
  }

  return segments.join('/');
}

/**
 * Derives unique desired relative paths for a set of items, resolving collisions deterministically.
 */
export function resolveItemPaths(
  items: PathItemReference[],
  itemMap: Map<string, PathItemReference>,
): Map<string, string> {
  const resolvedPaths = new Map<string, string>();
  const usedPaths = new Set<string>();

  // Sort deterministically by item ID so collisions resolve consistently across runs
  const sorted = [...items].sort((a, b) => a.id.localeCompare(b.id));

  for (const item of sorted) {
    const rawPath = computeRelativePath(item, itemMap);
    let finalPath = rawPath;

    if (usedPaths.has(finalPath)) {
      const ext = extname(rawPath);
      const base = rawPath.slice(0, rawPath.length - ext.length);
      const suffix = ` (${item.id.slice(0, 6)})`;
      finalPath = `${base}${suffix}${ext}`;

      // Fallback if 6 chars still collides
      let counter = 2;
      while (usedPaths.has(finalPath)) {
        finalPath = `${base}${suffix}-${counter}${ext}`;
        counter++;
      }
    }

    usedPaths.add(finalPath);
    resolvedPaths.set(item.id, finalPath);
  }

  return resolvedPaths;
}
