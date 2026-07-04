// Optional diagnostics for `royalties doctor`. When ROYALTIES_DEBUG=1, each
// PostToolUse records the SHAPE of the hook payload it received — field NAMES
// only, plus the Bash exit code (a number). No field values are stored, so this
// cannot capture commands, paths, or output. It exists so you can confirm which
// exit-code field your Claude Code version delivers (error events fail closed
// when none is present).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isDebug, paths } from './config.js';

export interface HookDebug {
  at: string;
  hook_event_name?: string;
  tool_name?: string;
  top_level_keys: string[];
  tool_input_keys: string[];
  exit_code_found: boolean;
  exit_code: number | null;
  exit_code_source: string | null;
}

export function recordHookDebug(record: HookDebug): void {
  if (!isDebug()) return;
  mkdirSync(paths.home, { recursive: true });
  writeFileSync(paths.debug, JSON.stringify(record, null, 2));
}

export function readHookDebug(): HookDebug | null {
  if (!existsSync(paths.debug)) return null;
  try {
    return JSON.parse(readFileSync(paths.debug, 'utf8')) as HookDebug;
  } catch {
    return null;
  }
}
