// Regression tests pinned to the real Claude Code 2.1.201 hook payload shape
// (captured via `royalties doctor`): the tool result arrives under
// `tool_response` (not `tool_output`), there is no top-level `bash_exit_code`,
// and the top level also carries cwd/duration_ms/effort/permission_mode/
// prompt_id/tool_use_id. These lock in: compound-command dependency extraction,
// exit-code discovery inside tool_response, and immediate SessionEnd finalize.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleHook } from '../src/hooks/handle.js';
import { finalize } from '../src/finalize.js';
import { loadState } from '../src/state.js';
import { peekPanelistId } from '../src/panelist.js';
import { readEvents } from '../src/queue.js';
import { paths } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

const DEFAULT_RESPONSE = { stdout: '', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };

/** A Bash PostToolUse payload with the exact 2.1.201 top-level structure. */
function bashPost(dir: string, command: string, toolResponse: unknown = DEFAULT_RESPONSE): Record<string, unknown> {
  return {
    cwd: dir,
    duration_ms: 1234,
    effort: 'high',
    hook_event_name: 'PostToolUse',
    permission_mode: 'default',
    prompt_id: 'pr_1',
    session_id: 's201',
    tool_input: { command, description: command },
    tool_name: 'Bash',
    tool_response: toolResponse,
    tool_use_id: 'tu_1',
    transcript_path: join(dir, 'missing.jsonl'),
  };
}

/** Drive SessionStart + one Bash PostToolUse, finalize, return dep package names. */
async function depsFor(command: string, toolResponse?: unknown): Promise<Record<string, unknown>[]> {
  const dir = mkdtempSync(join(tmpdir(), 'royalties-201-'));
  const post = bashPost(dir, command, toolResponse);
  await handleHook({ ...post, hook_event_name: 'SessionStart' } as never);
  await handleHook(post as never);
  finalize(loadState('s201')!, peekPanelistId() ?? 'p_00000000', Date.now());
  return readEvents(paths.queue);
}

const packagesOf = (events: Record<string, unknown>[]): string[] =>
  events.filter((e) => e.type === 'dependency_added').map((e) => String(e.package));

it('extracts a simple install from the exact 2.1.201 payload', async () => {
  expect(packagesOf(await depsFor('npm install left-pad'))).toEqual(['left-pad']);
});

it('extracts an install chained after another command with &&', async () => {
  // Regression: `npm init -y && npm install resend` used to yield nothing —
  // only the first sub-command was parsed.
  expect(packagesOf(await depsFor('npm init -y && npm install resend'))).toEqual(['resend']);
});

it('never emits shell operators or later words as packages', async () => {
  // Regression: `--save-dev typescript && npm run build` used to also emit
  // '&&', 'npm', 'run', 'build' as bogus packages.
  expect(packagesOf(await depsFor('npm install --save-dev typescript && npm run build'))).toEqual(['typescript']);
});

it('SessionEnd finalizes the session immediately — no 20-minute wait', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'royalties-end-'));
  const transcriptPath = join(dir, 'session.jsonl');
  writeFileSync(
    transcriptPath,
    [
      { type: 'user', timestamp: '2026-07-04T10:00:00.000Z', version: '2.1.201', message: { role: 'user', content: 'add left-pad' } },
      { type: 'assistant', timestamp: '2026-07-04T10:05:00.000Z', version: '2.1.201', message: { role: 'assistant', model: 'claude-opus-4-8', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 50 } } },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n') + '\n',
  );

  const idBase = { cwd: dir, session_id: 's-end', transcript_path: transcriptPath };
  await handleHook({ ...idBase, hook_event_name: 'SessionStart' } as never);
  await handleHook({ ...bashPost(dir, 'npm install left-pad'), ...idBase, hook_event_name: 'PostToolUse' } as never);

  // Still in progress: nothing queued yet.
  expect(readEvents(paths.queue)).toHaveLength(0);

  await handleHook({ ...idBase, hook_event_name: 'SessionEnd', end_reason: 'prompt_input_exit' } as never);

  const types = readEvents(paths.queue).map((e) => e.type);
  expect(types).toContain('session');
  expect(types).toContain('dependency_added');
  expect(loadState('s-end')).toBeNull(); // state is cleaned up on end
});
