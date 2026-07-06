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
  // Set when the server 409s our registration: our id is already registered and
  // holds its write-once token, which we no longer have. The id stays; the token
  // is unrecoverable locally. `royalties doctor` surfaces this as stuck auth.
  register_conflict_at?: string;
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
  mkdirSync(paths.home, { recursive: true });
  const file: PanelistFile = { panelist_id: 'p_' + randomUUID(), created_at: new Date().toISOString() };
  try {
    // 'wx' fails if the file already exists, so a racing hook + CLI (or any
    // second process) can never overwrite an established identity — the first
    // writer wins and everyone else adopts it. Forking the id breaks payouts.
    writeFileSync(paths.panelist, JSON.stringify(file, null, 2) + '\n', { flag: 'wx' });
    return file.panelist_id;
  } catch {
    // Someone created it first (or is mid-write); adopt their id, never mint a
    // divergent one. Spin briefly in the rare create-but-not-yet-written window.
    for (let i = 0; i < 50; i++) {
      const existing = readPanelist();
      if (existing?.panelist_id) return existing.panelist_id;
    }
    return readPanelist()?.panelist_id ?? file.panelist_id;
  }
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
  delete p.register_conflict_at; // we hold a valid token again — no longer stuck
  write(p);
}

/** Forget a token the server rejected (401); we re-register on the next send.
 *  The panelist id is preserved — a rejected token never changes our identity. */
export function clearToken(): void {
  const p = readPanelist();
  if (!p?.token) return;
  delete p.token;
  delete p.registered_at;
  write(p);
}

/** Record that registration was refused with a 409: the server already holds
 *  this id's write-once token, which we lack. We keep the id (never fork) but
 *  can't obtain a token, so `royalties doctor` reports the auth as stuck. */
export function markRegisterConflict(): void {
  const p = readPanelist();
  if (!p || p.register_conflict_at) return; // no identity yet, or already marked
  p.register_conflict_at = new Date().toISOString();
  write(p);
}

/** True when we have an id but no token AND a prior registration was refused
 *  (409) — the unrecoverable "stuck auth" state doctor warns about, distinct
 *  from merely-not-registered-yet (where re-registration can still succeed). */
export function isAuthStuck(): boolean {
  const p = readPanelist();
  return !!p && !p.token && !!p.register_conflict_at;
}
