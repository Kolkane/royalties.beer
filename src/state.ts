// Per-session working state. The hooks accumulate whitelisted observations here
// during a session; finalize.ts turns a state into events once the session goes
// idle. Nothing here is ever sent directly — only finalized, serialized events
// reach the queue.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paths } from './config.js';

export interface DepObs {
  ecosystem: string;
  package: string;
  version?: string;
}

/** One Bash tool result: category of the command + a hash to correlate retries. */
export interface ErrObs {
  category: string;
  sig: string;
  ok: boolean;
}

export interface SessionState {
  session_id: string;
  transcript_path: string;
  cwd: string;
  started_at: number;
  updated_at: number;
  language?: string;
  framework?: string;
  agent_version?: string;
  detected?: boolean;
  deps: DepObs[];
  domains: string[];
  errors: ErrObs[];
}

export function newState(id: string, transcriptPath: string, cwd: string): SessionState {
  const now = Date.now();
  return {
    session_id: id,
    transcript_path: transcriptPath,
    cwd,
    started_at: now,
    updated_at: now,
    deps: [],
    domains: [],
    errors: [],
  };
}

export function loadState(id: string): SessionState | null {
  const file = paths.session(id);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as SessionState;
  } catch {
    return null;
  }
}

export function saveState(state: SessionState): void {
  mkdirSync(paths.sessionsDir, { recursive: true });
  state.updated_at = Date.now();
  writeFileSync(paths.session(state.session_id), JSON.stringify(state, null, 2));
}

export function deleteState(id: string): void {
  const file = paths.session(id);
  if (existsSync(file)) rmSync(file);
}

export function listStates(): SessionState[] {
  if (!existsSync(paths.sessionsDir)) return [];
  const out: SessionState[] = [];
  for (const name of readdirSync(paths.sessionsDir)) {
    if (!name.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(paths.sessionsDir, name), 'utf8')) as SessionState);
    } catch {
      // ignore unreadable state files
    }
  }
  return out;
}
