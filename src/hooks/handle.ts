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
import { finalizeStale } from '../finalize.js';
import { flush } from '../send.js';
import { recordHookDebug } from '../debug.js';
import { loadState, newState, saveState, type DepObs, type SessionState } from '../state.js';

export interface HookInput {
  hook_event_name?: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: unknown;
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
    exit_code_found: exit.code !== null,
    exit_code: exit.code,
    exit_code_source: exit.source,
  });
}

function onStop(input: HookInput): void {
  const id = input.session_id;
  if (!id) return;
  const state = loadState(id);
  if (state) saveState(state); // keep the session "fresh" so it isn't finalized mid-flight
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
  const out = input.tool_output;
  if (out && typeof out === 'object') {
    const rec = out as Record<string, unknown>;
    for (const key of ['exit_code', 'exitCode', 'code']) {
      if (typeof rec[key] === 'number') return { code: rec[key] as number, source: `tool_output.${key}` };
    }
  }
  return { code: null, source: null };
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
