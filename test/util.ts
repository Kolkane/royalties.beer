import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { CLAUDE_SETTINGS_PATH, paths } from '../src/config.js';

/** Wipe all local state between tests (paths come from the temp dirs in setup.ts). */
export function resetAll(): void {
  rmSync(paths.home, { recursive: true, force: true });
  rmSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true, force: true });
  mkdirSync(paths.home, { recursive: true });
}
