// The random panelist id. It is the only identifier attached to events, and it
// has no link to a name or email in the event stream (see PRIVACY.md).
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { paths } from './config.js';

interface PanelistFile {
  panelist_id: string;
  created_at: string;
}

/** Read the panelist id, creating one on first use. */
export function getPanelistId(): string {
  const existing = peekPanelistId();
  return existing ?? createPanelist();
}

export function createPanelist(): string {
  mkdirSync(paths.home, { recursive: true });
  const file: PanelistFile = { panelist_id: 'p_' + randomUUID(), created_at: new Date().toISOString() };
  writeFileSync(paths.panelist, JSON.stringify(file, null, 2) + '\n');
  return file.panelist_id;
}

/** Return the current id without creating one, or null if none exists. */
export function peekPanelistId(): string | null {
  if (!existsSync(paths.panelist)) return null;
  try {
    const file = JSON.parse(readFileSync(paths.panelist, 'utf8')) as PanelistFile;
    return file.panelist_id ?? null;
  } catch {
    return null;
  }
}
