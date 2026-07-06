// Installs / removes the collector's hooks in ~/.claude/settings.json.
//
// `install` is non-destructive: it appends our three hook entries and leaves any
// existing hooks untouched. Before changing anything it saves a backup holding
// the exact original bytes AND the exact bytes it is about to write. `uninstall`
// uses that backup to restore byte-for-byte when the file is unchanged since
// init; if the user edited settings.json in between, it falls back to removing
// only our entries so their edits survive.
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLAUDE_SETTINGS_PATH, paths } from '../config.js';

const HOOK_ARG = '__hook';
const POST_TOOL_MATCHER = 'Bash|Write|Edit|MultiEdit';

interface Backup {
  existed: boolean;
  original: string;
  installed: string;
}

export interface InstallResult {
  changed: boolean;
  alreadyInstalled: boolean;
  settingsPath: string;
  command: string;
}

export interface UninstallResult {
  restored: 'backup' | 'absent' | 'surgical' | 'nothing';
  settingsPath: string;
}

export function install(): InstallResult {
  // Copy the compiled CLI to a stable location we own, and point the hooks there.
  // Installed via `npx`, the running CLI lives in npm's _npx cache, which npx can
  // evict at any time — the hooks would then reference a deleted file and die
  // silently. ~/.royalties/bin never moves, so the hooks survive cache evictions
  // and node upgrades. Re-running this also refreshes/repairs that copy.
  const command = hookCommand(copyBin(sourceRoot(), paths.bin));

  const raw = existsSync(CLAUDE_SETTINGS_PATH) ? readFileSync(CLAUDE_SETTINGS_PATH, 'utf8') : null;
  const settings = raw ? safeParse(raw) : {};

  if (installedAt(settings, command)) {
    // Our hooks are present AND already point at the stable bin — the copy above
    // refreshed it; nothing in settings needs to change.
    return { changed: false, alreadyInstalled: true, settingsPath: CLAUDE_SETTINGS_PATH, command };
  }

  // Drop any stale entries of ours first (e.g. a prior install that pointed into
  // the npx cache) so re-running `init` MIGRATES the hook path in place.
  const hadOurs = ourCommands(settings).length > 0;
  const cleaned = withoutOurEntries(settings);
  const hooks = isRecord(cleaned.hooks) ? { ...cleaned.hooks } : {};
  for (const [event, entry] of Object.entries(ourHooks(command))) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, entry];
  }
  cleaned.hooks = hooks;
  const installed = JSON.stringify(cleaned, null, 2) + '\n';

  mkdirSync(paths.home, { recursive: true });
  // Restore target on uninstall: the exact original bytes for a fresh install
  // (byte-identical restore), or a re-serialized copy WITHOUT our entries when we
  // migrated an existing install (so uninstall leaves no royalties hooks behind).
  const original = hadOurs ? JSON.stringify(withoutOurEntries(settings), null, 2) + '\n' : (raw ?? '');
  const backup: Backup = { existed: raw !== null, original, installed };
  writeFileSync(backupPath(), JSON.stringify(backup));

  mkdirSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, installed);
  return { changed: true, alreadyInstalled: false, settingsPath: CLAUDE_SETTINGS_PATH, command };
}

export function uninstall(): UninstallResult {
  removeBinCopy(); // remove the stable CLI copy (independent of the settings edit below)
  const backupFile = backupPath();
  if (existsSync(backupFile)) {
    const backup = JSON.parse(readFileSync(backupFile, 'utf8')) as Backup;
    const current = existsSync(CLAUDE_SETTINGS_PATH) ? readFileSync(CLAUDE_SETTINGS_PATH, 'utf8') : null;
    if (current === backup.installed) {
      // Unchanged since init — restore the original exactly.
      if (backup.existed) writeFileSync(CLAUDE_SETTINGS_PATH, backup.original);
      else if (current !== null) rmSync(CLAUDE_SETTINGS_PATH);
      rmSync(backupFile);
      return { restored: backup.existed ? 'backup' : 'absent', settingsPath: CLAUDE_SETTINGS_PATH };
    }
    rmSync(backupFile); // user edited settings after init — keep their edits.
  }
  return { restored: surgicalRemove() ? 'surgical' : 'nothing', settingsPath: CLAUDE_SETTINGS_PATH };
}

export function isInstalled(settings: Record<string, unknown>): boolean {
  if (!isRecord(settings.hooks)) return false;
  return Object.values(settings.hooks).some((arr) => Array.isArray(arr) && arr.some(isOurEntry));
}

/**
 * The command Claude Code runs for each hook. Cross-platform by design:
 *   - invoked via `node` on PATH (npm guarantees node where royalties installed),
 *   - the script path uses forward slashes, which Node accepts on every OS,
 * so the same settings.json line works on macOS, Linux and Windows.
 */
export function hookCommand(cliPath: string): string {
  return `node ${quote(cliPath.replace(/\\/g, '/'))} ${HOOK_ARG}`;
}

/** Root of the running package (holds dist/ + package.json). Resolved from this
 *  module's own location so it works from an _npx cache or a global install.
 *  ROYALTIES_SRC overrides it for tests / self-host. */
function sourceRoot(): string {
  return process.env.ROYALTIES_SRC ?? fileURLToPath(new URL('../../', import.meta.url));
}

/** Copy the compiled CLI (dist/ + package.json + SCHEMA.md) from `srcRoot` into a
 *  stable dir we own, and return the path to the copied cli.js (forward-slashed
 *  for settings.json). If we are already running from the destination, skip the
 *  copy so we never delete our own running files. */
export function copyBin(srcRoot: string, destBin: string): string {
  const srcDist = join(srcRoot, 'dist');
  const destDist = join(destBin, 'dist');
  const destCli = join(destDist, 'cli.js').replace(/\\/g, '/');
  if (resolve(srcDist) === resolve(destDist)) return destCli; // already the stable copy
  rmSync(destBin, { recursive: true, force: true }); // fresh copy (also upgrades/repairs)
  mkdirSync(destBin, { recursive: true });
  cpSync(srcDist, destDist, { recursive: true });
  for (const extra of ['package.json', 'SCHEMA.md']) {
    const from = join(srcRoot, extra);
    if (existsSync(from)) copyFileSync(from, join(destBin, extra));
  }
  return destCli;
}

function removeBinCopy(): void {
  rmSync(paths.bin, { recursive: true, force: true });
}

/** The cli.js path our installed hooks invoke, or null if not installed / the
 *  settings file is unreadable. Used by `doctor` and the self-heal guard.
 *  Never throws (unlike safeParse) — this runs on the hook hot path. */
export function installedHookCliPath(): string | null {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return null;
  let settings: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')) as unknown;
    if (!isRecord(parsed)) return null;
    settings = parsed;
  } catch {
    return null;
  }
  const command = ourCommands(settings)[0];
  const quoted = command?.match(/"([^"]+)"/);
  return quoted ? quoted[1] : null;
}

/** The cli.js this process is running from — the same computation hookCommand's
 *  path uses, so a normal (matching) run never trips the self-heal guard. */
export function runningHookCliPath(): string {
  return fileURLToPath(new URL('../cli.js', import.meta.url)).replace(/\\/g, '/');
}

/** True when our hooks are installed but point at a DIFFERENT cli.js than the one
 *  this process runs from — i.e. we are a superseded copy (e.g. an _npx-cache
 *  build still lingering after `init` relocated the hooks to ~/.royalties/bin).
 *  The hook runtime uses this to no-op safely instead of collecting from a stale
 *  path. Fails SAFE: any unknown/unreadable state returns false, so a normal run
 *  is never blocked. */
export function isSupersededHookRuntime(): boolean {
  const installed = installedHookCliPath();
  if (!installed) return false;
  return normalizePath(installed) !== normalizePath(runningHookCliPath());
}

function normalizePath(p: string): string {
  const s = p.replace(/\\/g, '/');
  return process.platform === 'win32' ? s.toLowerCase() : s;
}

/** Every royalties hook command currently in the settings object. */
function ourCommands(settings: Record<string, unknown>): string[] {
  if (!isRecord(settings.hooks)) return [];
  const out: string[] = [];
  for (const arr of Object.values(settings.hooks)) {
    if (!Array.isArray(arr)) continue;
    for (const entry of arr) {
      if (!isRecord(entry) || !Array.isArray(entry.hooks)) continue;
      for (const hook of entry.hooks) {
        const command = isRecord(hook) ? hook.command : undefined;
        if (typeof command === 'string' && command.includes(HOOK_ARG) && command.toLowerCase().includes('royalties')) {
          out.push(command);
        }
      }
    }
  }
  return out;
}

/** True if our hooks are present AND every one of them points at `command`. */
function installedAt(settings: Record<string, unknown>, command: string): boolean {
  const commands = ourCommands(settings);
  return commands.length > 0 && commands.every((c) => c === command);
}

/** A copy of `settings` with all of our hook entries removed (empty event arrays
 *  and an empty `hooks` object are dropped). Non-hook keys are untouched. */
function withoutOurEntries(settings: Record<string, unknown>): Record<string, unknown> {
  const out = { ...settings };
  if (!isRecord(settings.hooks)) return out;
  const hooks: Record<string, unknown> = {};
  for (const [event, arr] of Object.entries(settings.hooks)) {
    if (!Array.isArray(arr)) {
      hooks[event] = arr;
      continue;
    }
    const kept = arr.filter((entry) => !isOurEntry(entry));
    if (kept.length > 0) hooks[event] = kept;
  }
  if (Object.keys(hooks).length > 0) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

/** True if our hooks are currently present in the on-disk settings file. */
export function statusInstalled(): boolean {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return false;
  try {
    return isInstalled(safeParse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')));
  } catch {
    return false;
  }
}

function ourHooks(command: string): Record<string, unknown> {
  const entry = { hooks: [{ type: 'command', command }] };
  return {
    SessionStart: entry,
    PostToolUse: { matcher: POST_TOOL_MATCHER, hooks: [{ type: 'command', command }] },
    Stop: entry,
    // SessionEnd finalizes the session immediately on exit (no matcher = every
    // end reason) instead of waiting out the 20-minute stale window.
    SessionEnd: entry,
  };
}

function surgicalRemove(): boolean {
  if (!existsSync(CLAUDE_SETTINGS_PATH)) return false;
  const settings = safeParse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
  if (!isRecord(settings.hooks)) return false;
  const hooks = settings.hooks;
  let changed = false;
  for (const [event, arr] of Object.entries(hooks)) {
    if (!Array.isArray(arr)) continue;
    const kept = arr.filter((entry) => !isOurEntry(entry));
    if (kept.length === arr.length) continue;
    changed = true;
    if (kept.length === 0) delete hooks[event];
    else hooks[event] = kept;
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  if (changed) writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  return changed;
}

function isOurEntry(entry: unknown): boolean {
  if (!isRecord(entry) || !Array.isArray(entry.hooks)) return false;
  return entry.hooks.some((hook) => {
    const command = isRecord(hook) ? hook.command : undefined;
    return typeof command === 'string' && command.includes(HOOK_ARG) && command.toLowerCase().includes('royalties');
  });
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw new Error(
      `Refusing to modify ${CLAUDE_SETTINGS_PATH}: it is not valid JSON. Fix it and re-run.`,
    );
  }
}

function backupPath(): string {
  return join(paths.home, 'claude-settings.backup.json');
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function quote(p: string): string {
  return `"${p}"`;
}
