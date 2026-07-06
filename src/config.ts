// Paths, endpoints and tunables. The three env overrides here are infrastructure
// knobs for testing/self-hosting only — they never become part of any payload.
import os from 'node:os';
import path from 'node:path';

const env = process.env;

/** The only agent this collector supports today. */
export const AGENT = 'claude-code';

/** Root of local state — the panelist identity lives here, so it MUST resolve
 *  identically for the CLI and the hook runtime. `os.homedir()` is the single
 *  resolver: on Windows it reads USERPROFILE (never HOME), so it is stable across
 *  shells, reboots and the CLI-vs-hook split. Do NOT switch this to HOME or any
 *  other base — existing panelists already keep their id under this path, so
 *  changing it would fork every identity. Override only via ROYALTIES_HOME (for
 *  tests / custom installs); if you set it, set it for BOTH the CLI and the hook
 *  or the panelist id will split. */
export const ROYALTIES_HOME = env.ROYALTIES_HOME ?? path.join(os.homedir(), '.royalties');

/** Claude Code settings file we install hooks into. Override for tests. */
export const CLAUDE_SETTINGS_PATH =
  env.ROYALTIES_CLAUDE_SETTINGS ?? path.join(os.homedir(), '.claude', 'settings.json');

/** The one and only network destination. Override with ROYALTIES_ENDPOINT (tests). */
export const EVENTS_ENDPOINT = env.ROYALTIES_ENDPOINT ?? 'https://ingest.royalties.beer/v1/events';

/** Registration endpoint (one-time, obtains the bearer token), derived from the
 *  events endpoint so the ROYALTIES_ENDPOINT override moves both together. */
export const REGISTER_ENDPOINT = EVENTS_ENDPOINT.replace(/\/events\/?$/, '/register');

/** Server-side deletion endpoint, derived from the events endpoint. */
export const PURGE_ENDPOINT = EVENTS_ENDPOINT.replace(/\/events\/?$/, '/purge');

/** Optional invite code sent as X-Invite-Code when registering (if the server
 *  gates registration). Never part of any event payload. */
export const INVITE_CODE = env.ROYALTIES_INVITE_CODE ?? '';

export const paths = {
  home: ROYALTIES_HOME,
  queue: path.join(ROYALTIES_HOME, 'queue.jsonl'),
  log: path.join(ROYALTIES_HOME, 'log.jsonl'),
  panelist: path.join(ROYALTIES_HOME, 'panelist.json'),
  paused: path.join(ROYALTIES_HOME, 'paused'),
  sessionsDir: path.join(ROYALTIES_HOME, 'sessions'),
  session: (id: string) => path.join(ROYALTIES_HOME, 'sessions', sessionFile(id)),
  debug: path.join(ROYALTIES_HOME, 'last-hook.json'),
  runtime: path.join(ROYALTIES_HOME, 'runtime.json'),
};

/** ROYALTIES_DEBUG=1 records the last hook's field names for `royalties doctor`.
 *  Read live (not cached) so the hook process picks it up from its environment. */
export function isDebug(): boolean {
  return process.env.ROYALTIES_DEBUG === '1';
}

/** A session is finalized (turned into events) once idle for this long. */
export const STALE_MS = 20 * 60 * 1000;

/** Max events per POST to the ingest endpoint. */
export const SEND_BATCH = 100;

/** Filename of the .royaltiesignore opt-out marker. */
export const IGNORE_FILE = '.royaltiesignore';

function sessionFile(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
}
