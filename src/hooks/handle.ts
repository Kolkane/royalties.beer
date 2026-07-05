// The hook runtime. `royalties __hook` reads the hook's stdin JSON and calls
// handleHook. It is intentionally side-effect-only and must never block or fail
// the agent: PostToolUse just accumulates whitelisted observations into session
// state, and only session boundaries touch the network (time-boxed, best-effort).
import { isIgnored, isPaused } from '../ignore.js';
import { getPanelistId } from '../panelist.js';
import { detectFramework, detectLanguage } from '../detect.js';
import { depsFromCommand, depsFromManifest } from '../extract/dependency.js';
import { domainsInContent } from '../extract/api-domain.js';
import { classifyCommand, commandSig } from '../extract/error.js';
import { finalize, finalizeStale } from '../finalize.js';
import { flush } from '../send.js';
import { recordHookDebug } from '../debug.js';
import { deleteState, loadState, newState, saveState, type DepObs, type SessionState } from '../state.js';

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
  tool_response?: unknown;
  bash_exit_code?: number;
}

export async function handleHook(input: HookInput): Promise<void> {
  if (isPaused()) return;
  if (isIgnored(input.cwd ?? '')) return; // .royaltiesignore -> zero events

  if (input.hook_event_name === 'PostToolUse') {
    onPostToolUse(input); // hot path: accumulate only, no network
    return;
  }

  const panelistId = getPanelistId();
  if (input.hook_event_name === 'SessionStart') onSessionStart(input);
  else if (input.hook_event_name === 'Stop') onStop(input);
  else if (input.hook_event_name === 'SessionEnd') onSessionEnd(input, panelistId);
  finalizeStale(panelistId);
  await flush(4000).catch(() => undefined);
}

function onSessionStart(input: HookInput): void {
  const id = input.session_id;
  if (!id) return;
  const state = loadState(id) ?? newState(id, input.transcript_path ?? '', input.cwd ?? '');
  if (input.transcript_path) state.transcript_path = input.transcript_path;
  if (input.cwd) state.cwd = input.cwd;
  applyDetection(state);
  saveState(state);
}

function onPostToolUse(input: HookInput): void {
  const id = input.session_id;
  if (!id) return;
  const state = loadState(id) ?? newState(id, input.transcript_path ?? '', input.cwd ?? '');
  if (input.transcript_path && !state.transcript_path) state.transcript_path = input.transcript_path;
  applyDetection(state);

  const ti = input.tool_input ?? {};
  const exit = { code: null as number | null, source: null as string | null };
  if (input.tool_name === 'Bash') {
    const command = typeof ti.command === 'string' ? ti.command : '';
    if (command) {
      for (const dep of depsFromCommand(command)) addDep(state, dep);
      Object.assign(exit, bashExitInfo(input));
      if (exit.code !== null) {
        state.errors.push({ category: classifyCommand(command), sig: commandSig(command), ok: exit.code === 0 });
      }
    }
  } else if (input.tool_name === 'Write' || input.tool_name === 'Edit' || input.tool_name === 'MultiEdit') {
    const content = writtenContent(ti);
    if (content) {
      for (const domain of domainsInContent(content)) {
        if (!state.domains.includes(domain)) state.domains.push(domain);
      }
      const filePath = typeof ti.file_path === 'string' ? ti.file_path : '';
      for (const dep of depsFromManifest(filePath, content)) addDep(state, dep);
    }
  }
  saveState(state);

  recordHookDebug({
    at: new Date().toISOString(),
    hook_event_name: input.hook_event_name,
    tool_name: input.tool_name,
    top_level_keys: Object.keys(input).sort(),
    tool_input_keys: Object.keys(ti).sort(),
    tool_response_keys: keysOf(input.tool_response),
    exit_code_found: exit.code !== null,
    exit_code: exit.code,
    exit_code_source: exit.source,
  });
}

/** Field NAMES of an object payload (sorted), or null if it isn't a plain
 *  object. Lets `royalties doctor` reveal where a Claude Code version hides the
 *  Bash exit code, without ever recording a value. */
function keysOf(v: unknown): string[] | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v as Record<string, unknown>).sort()
    : null;
}

function onStop(input: HookInput): void {
  const id = input.session_id;
  if (!id) return;
  const state = loadState(id);
  if (state) saveState(state); // keep the session "fresh" so it isn't finalized mid-flight
}

// SessionEnd fires when the session actually ends (/exit, logout, clear, ...).
// Finalize it right away so its events ship immediately instead of sitting "in
// progress" until the 20-minute stale window elapses.
function onSessionEnd(input: HookInput, panelistId: string): void {
  const id = input.session_id;
  if (!id) return;
  const state = loadState(id);
  if (!state) return;
  if (input.transcript_path && !state.transcript_path) state.transcript_path = input.transcript_path;
  finalize(state, panelistId);
  deleteState(id);
}

function applyDetection(state: SessionState): void {
  if (state.detected || !state.cwd) return;
  state.language = detectLanguage(state.cwd);
  state.framework = detectFramework(state.cwd);
  state.detected = true;
}

function addDep(state: SessionState, dep: DepObs): void {
  const existing = state.deps.find((d) => d.ecosystem === dep.ecosystem && d.package === dep.package);
  if (!existing) state.deps.push(dep);
  else if (dep.version && !existing.version) existing.version = dep.version;
}

/** The failure signal for `error` events. Claude Code exposes a Bash exit code on
 *  the PostToolUse payload; if it isn't present we emit no error (fail closed).
 *  Returns which field it came from too, so `royalties doctor` can report it. */
function bashExitInfo(input: HookInput): { code: number | null; source: string | null } {
  if (typeof input.bash_exit_code === 'number') return { code: input.bash_exit_code, source: 'bash_exit_code' };
  // Claude Code 2.1.201 moved the tool result from `tool_output` to
  // `tool_response` and no longer surfaces the exit code at top level. A SUCCESS
  // result is an object ({stdout, stderr, ...}); a FAILURE arrives as a text
  // string ending in "Error: Exit code N" (also flagged is_error). Probe every
  // shape we've observed; if none yields a code we emit no error (fail closed).
  for (const container of ['tool_response', 'tool_output'] as const) {
    const obj = input[container];
    if (typeof obj === 'string') {
      const code = codeFromText(obj);
      if (code !== null) return { code, source: `${container}:exit-code-text` };
      continue;
    }
    if (!obj || typeof obj !== 'object') continue;
    const rec = obj as Record<string, unknown>;
    for (const key of ['exit_code', 'exitCode', 'returnCode', 'code', 'status']) {
      if (typeof rec[key] === 'number') return { code: rec[key] as number, source: `${container}.${key}` };
    }
    if (typeof rec.is_error === 'boolean') return { code: rec.is_error ? 1 : 0, source: `${container}.is_error` };
    for (const key of ['was_successful', 'success', 'ok']) {
      if (typeof rec[key] === 'boolean') return { code: rec[key] ? 0 : 1, source: `${container}.${key}` };
    }
    if (typeof rec.content === 'string') {
      const code = codeFromText(rec.content);
      if (code !== null) return { code, source: `${container}.content:exit-code-text` };
    }
  }
  // Some versions surface a top-level success boolean / is_error instead.
  const top = input as Record<string, unknown>;
  for (const key of ['was_successful', 'success'] as const) {
    if (typeof top[key] === 'boolean') return { code: top[key] ? 0 : 1, source: key };
  }
  if (typeof top.is_error === 'boolean') return { code: top.is_error ? 1 : 0, source: 'is_error' };
  return { code: null, source: null }; // fail closed: no signal -> no error event
}

/** Pull an exit code out of Claude Code's failure text ("...Error: Exit code 2").
 *  Uses the LAST match — the trailing status line, not stray output above it. */
function codeFromText(text: string): number | null {
  const matches = [...text.matchAll(/\bexit code\s+(\d+)\b/gi)];
  return matches.length === 0 ? null : Number(matches[matches.length - 1][1]);
}

function writtenContent(ti: Record<string, unknown>): string {
  if (typeof ti.content === 'string') return ti.content;
  if (typeof ti.new_string === 'string') return ti.new_string;
  if (Array.isArray(ti.edits)) {
    return ti.edits
      .map((edit) => {
        const rec = edit && typeof edit === 'object' ? (edit as Record<string, unknown>) : {};
        return typeof rec.new_string === 'string' ? rec.new_string : '';
      })
      .join('\n');
  }
  return '';
}
