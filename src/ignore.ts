// Local opt-out controls: a global pause flag, and a per-project .royaltiesignore.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IGNORE_FILE, paths } from './config.js';

/** `royalties pause` creates this flag; while it exists the collector is inert. */
export function isPaused(): boolean {
  return existsSync(paths.paused);
}

/**
 * True if `startDir` or any parent directory contains a .royaltiesignore file.
 * Dropping that file in a project root yields zero events from that project.
 */
export function isIgnored(startDir: string): boolean {
  if (!startDir) return false;
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, IGNORE_FILE))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}
