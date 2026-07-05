// Installs / removes the collector's hooks in ~/.claude/settings.json.
//
// `install` is non-destructive: it appends our three hook entries and leaves any
// existing hooks untouched. Before changing anything it saves a backup holding
// the exact original bytes AND the exact bytes it is about to write. `uninstall`
// uses that backup to restore byte-for-byte when the file is unchanged since
// init; if the user edited settings.json in between, it falls back to removing
// only our entries so their edits survive.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  const raw = existsSync(CLAUDE_SETTINGS_PATH) ? readFileSync(CLAUDE_SETTINGS_PATH, 'utf8') : null;
  const settings = raw ? safeParse(raw) : {};
  const command = hookCommand();

  if (isInstalled(settings)) {
    return { changed: false, alreadyInstalled: true, settingsPath: CLAUDE_SETTINGS_PATH, command };
  }

  const hooks = isRecord(settings.hooks) ? { ...settings.hooks } : {};
  for (const [event, entry] of Object.entries(ourHooks(command))) {
    const existing = Array.isArray(hooks[event]) ? (hooks[event] as unknown[]) : [];
    hooks[event] = [...existing, entry];
  }
  settings.hooks = hooks;
  const installed = JSON.stringify(settings, null, 2) + '\n';

  mkdirSync(paths.home, { recursive: true });
  const backup: Backup = { existed: raw !== null, original: raw ?? '', installed };
  writeFileSync(backupPath(), JSON.stringify(backup));

  mkdirSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, installed);
  return { changed: true, alreadyInstalled: false, settingsPath: CLAUDE_SETTINGS_PATH, command };
}

export function uninstall(): UninstallResult {
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
export function hookCommand(): string {
  const cli = fileURLToPath(new URL('../cli.js', import.meta.url)).replace(/\\/g, '/');
  return `node ${quote(cli)} ${HOOK_ARG}`;
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
