// Optional diagnostics for `royalties doctor`. When ROYALTIES_DEBUG=1, each
// PostToolUse records the SHAPE of the hook payload it received — field NAMES
// only (top level, tool_input, and tool_response), plus the Bash exit code (a
// number). No field values are stored, so this cannot capture commands, paths,
// or output. It exists so you can confirm which field your Claude Code version
// delivers the exit code in (error events fail closed when none is present).
// The last payload is kept PER tool_name, so a Bash record isn't overwritten by
// the next Write/Edit.
import os from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isDebug, paths } from './config.js';

export interface HookDebug {
  at: string;
  hook_event_name?: string;
  tool_name?: string;
  top_level_keys: string[];
  tool_input_keys: string[];
  tool_response_keys: string[] | null;
  exit_code_found: boolean;
  exit_code: number | null;
  exit_code_source: string | null;
}

/** The last recorded payload shape for each distinct tool_name. */
export type HookDebugByTool = Record<string, HookDebug>;

export function recordHookDebug(record: HookDebug): void {
  if (!isDebug()) return;
  mkdirSync(paths.home, { recursive: true });
  const all = readHookDebug() ?? {};
  all[record.tool_name ?? '(none)'] = record;
  writeFileSync(paths.debug, JSON.stringify(all, null, 2));
}

export function readHookDebug(): HookDebugByTool | null {
  if (!existsSync(paths.debug)) return null;
  try {
    const parsed = JSON.parse(readFileSync(paths.debug, 'utf8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    // Legacy 0.2.0 stored a single record (identified by a top-level string
    // `at`) rather than a map keyed by tool_name. Wrap it so old files don't
    // crash `doctor`; the next recorded hook rewrites the file in the new shape.
    if (typeof (parsed as Record<string, unknown>).at === 'string') {
      const rec = parsed as unknown as HookDebug;
      return { [rec.tool_name ?? '(none)']: rec };
    }
    return parsed as HookDebugByTool;
  } catch {
    return null;
  }
}

/** A stored value that is actually a HookDebug record (object with a string
 *  `at`). Guards `doctor` against legacy/garbage entries. */
export function isHookDebug(v: unknown): v is HookDebug {
  return !!v && typeof v === 'object' && typeof (v as Record<string, unknown>).at === 'string';
}

/** Identity as the HOOK process resolved it — always recorded (not gated by
 *  ROYALTIES_DEBUG) so `doctor` can prove the hook and CLI share one home + id.
 *  If the hook resolves a different home, this file lands there and `doctor`
 *  (reading the CLI's home) sees none — itself the tell for an identity split. */
export interface RuntimeMarker {
  at: string;
  home: string;
  panelist_id: string | null;
  homedir: string;
  userprofile?: string;
  home_env?: string;
}

export function recordRuntime(panelistId: string | null): void {
  try {
    const prev = readRuntime();
    if (prev && prev.home === paths.home && prev.panelist_id === panelistId && prev.homedir === os.homedir()) {
      return; // unchanged — avoid rewriting on every hook invocation
    }
    mkdirSync(paths.home, { recursive: true });
    const marker: RuntimeMarker = {
      at: new Date().toISOString(),
      home: paths.home,
      panelist_id: panelistId,
      homedir: os.homedir(),
      userprofile: process.env.USERPROFILE,
      home_env: process.env.HOME,
    };
    writeFileSync(paths.runtime, JSON.stringify(marker, null, 2));
  } catch {
    // Diagnostics only — must never affect the hook.
  }
}

export function readRuntime(): RuntimeMarker | null {
  if (!existsSync(paths.runtime)) return null;
  try {
    return JSON.parse(readFileSync(paths.runtime, 'utf8')) as RuntimeMarker;
  } catch {
    return null;
  }
}
