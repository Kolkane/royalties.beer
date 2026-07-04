// The random panelist id and its bearer token. The id is the only identifier
// attached to events, with no link to a name or email in the event stream (see
// PRIVACY.md). The token is an opaque credential obtained once from the ingest
// server at registration and sent as `Authorization: Bearer` — it is never part
// of any event payload.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { paths } from './config.js';

interface PanelistFile {
  panelist_id: string;
  created_at: string;
  token?: string;
  registered_at?: string;
}

export interface Auth {
  panelistId: string;
  token: string;
}

export function readPanelist(): PanelistFile | null {
  if (!existsSync(paths.panelist)) return null;
  try {
    return JSON.parse(readFileSync(paths.panelist, 'utf8')) as PanelistFile;
  } catch {
    return null;
  }
}

function write(file: PanelistFile): void {
  mkdirSync(paths.home, { recursive: true });
  writeFileSync(paths.panelist, JSON.stringify(file, null, 2) + '\n');
}

/** Read the panelist id, creating one on first use. */
export function getPanelistId(): string {
  return readPanelist()?.panelist_id ?? createPanelist();
}

export function createPanelist(): string {
  const file: PanelistFile = { panelist_id: 'p_' + randomUUID(), created_at: new Date().toISOString() };
  write(file);
  return file.panelist_id;
}

export function peekPanelistId(): string | null {
  return readPanelist()?.panelist_id ?? null;
}

/** The panelist id + token, or null if not registered yet. */
export function getAuth(): Auth | null {
  const p = readPanelist();
  return p?.token ? { panelistId: p.panelist_id, token: p.token } : null;
}

export function saveToken(panelistId: string, token: string): void {
  const p = readPanelist() ?? { panelist_id: panelistId, created_at: new Date().toISOString() };
  p.panelist_id = panelistId;
  p.token = token;
  p.registered_at = new Date().toISOString();
  write(p);
}

/** Forget a token the server rejected (401); we re-register on the next send. */
export function clearToken(): void {
  const p = readPanelist();
  if (!p?.token) return;
  delete p.token;
  delete p.registered_at;
  write(p);
}

/** Mint a fresh id (dropping any token), used when the server says our id is
 *  already registered but we no longer hold its token. */
export function rotatePanelist(): string {
  const file: PanelistFile = { panelist_id: 'p_' + randomUUID(), created_at: new Date().toISOString() };
  write(file);
  return file.panelist_id;
}
