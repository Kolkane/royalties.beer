// Optional diagnostics for `royalties doctor`. When ROYALTIES_DEBUG=1, each
// PostToolUse records the SHAPE of the hook payload it received — field NAMES
// only (top level, tool_input, and tool_response), plus the Bash exit code (a
// number). No field values are stored, so this cannot capture commands, paths,
// or output. It exists so you can confirm which field your Claude Code version
// delivers the exit code in (error events fail closed when none is present).
// The last payload is kept PER tool_name, so a Bash record isn't overwritten by
// the next Write/Edit.
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
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as HookDebugByTool)
      : null;
  } catch {
    return null;
  }
}
