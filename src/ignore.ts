// Local opt-out controls: a global pause flag, a per-project .royaltiesignore,
// and a persistent "disabled" tombstone dropped by purge/uninstall.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { IGNORE_FILE, paths } from './config.js';

/** `royalties pause` creates this flag; while it exists the collector is inert. */
export function isPaused(): boolean {
  return existsSync(paths.paused);
}

/** The tombstone `royalties purge`/`uninstall` drop. The hook runtime checks it
 *  FIRST, so any Claude Code session still running with our hooks installed goes
 *  inert immediately instead of collecting until it is restarted. Only
 *  `royalties init` clears it (the explicit opt back in). */
export function isDisabled(): boolean {
  return existsSync(paths.disabled);
}

/** Drop the tombstone. Called by `purge` and `uninstall`. */
export function disableCollector(): void {
  mkdirSync(paths.home, { recursive: true });
  writeFileSync(paths.disabled, new Date().toISOString() + '\n');
}

/** Clear the tombstone. Called only by `init` (re-opt-in). */
export function enableCollector(): void {
  if (existsSync(paths.disabled)) rmSync(paths.disabled);
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
