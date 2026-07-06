// error events are derived from the TRANSCRIPT at finalize (not the hook path):
// Claude Code 2.1.201's hook payload carries no exit code, but the transcript
// flags a failed Bash result with is_error:true and a string toolUseResult
// ("Error: Exit code N"). These tests use that real transcript shape.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvents } from '../src/finalize.js';
import type { SessionState } from '../src/state.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

const OK_RESULT = { stdout: 'done', stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
const NOW = Date.parse('2026-07-06T10:30:00.000Z');

function asstBash(ts: string, id: string, command: string, stop = 'tool_use'): unknown {
  return { type: 'assistant', timestamp: ts, version: '2.1.201', message: { role: 'assistant', model: 'claude-opus-4-8', stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } };
}
// A tool result: success is the {stdout,...} object, failure is the string
// "...Error: Exit code N" — both flagged via is_error on the tool_result block.
function toolResult(ts: string, id: string, isError: boolean, result: unknown): unknown {
  const contentText = typeof result === 'string' ? result : (result as { stdout: string }).stdout;
  return { type: 'user', timestamp: ts, toolUseResult: result, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: contentText }] } };
}
function endTurn(ts: string): unknown {
  return { type: 'assistant', timestamp: ts, version: '2.1.201', message: { role: 'assistant', model: 'claude-opus-4-8', stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } } };
}
function fixtureState(lines: unknown[]): SessionState {
  const dir = mkdtempSync(join(tmpdir(), 'royalties-tr-'));
  const p = join(dir, 'session.jsonl');
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { session_id: 's', transcript_path: p, cwd: dir, started_at: 0, updated_at: 0, deps: [], domains: [] };
}
const errorsOf = (events: Record<string, unknown>[]): Record<string, unknown>[] => events.filter((e) => e.type === 'error');

it('extracts an error event from a failing build in the transcript', () => {
  const state = fixtureState([
    asstBash('2026-07-06T10:00:00.000Z', 't1', 'npm run build'),
    toolResult('2026-07-06T10:00:30.000Z', 't1', true, 'npm error build failed\nError: Exit code 2'),
    endTurn('2026-07-06T10:01:00.000Z'),
  ]);
  const errs = errorsOf(buildEvents(state, 'p_00000000', NOW));
  expect(errs).toHaveLength(1);
  expect(errs[0]).toMatchObject({ category: 'build', retries: 1, resolved: false });
});

it('marks an error resolved when a later run of the same command succeeds', () => {
  const state = fixtureState([
    asstBash('2026-07-06T10:00:00.000Z', 't1', 'npm test'),
    toolResult('2026-07-06T10:00:20.000Z', 't1', true, 'fail\nError: Exit code 1'),
    asstBash('2026-07-06T10:01:00.000Z', 't2', 'npm test'),
    toolResult('2026-07-06T10:01:20.000Z', 't2', false, OK_RESULT),
    endTurn('2026-07-06T10:02:00.000Z'),
  ]);
  const errs = errorsOf(buildEvents(state, 'p_00000000', NOW));
  expect(errs).toHaveLength(1);
  expect(errs[0]).toMatchObject({ category: 'test', retries: 1, resolved: true });
});

it('emits no error when no tool result is flagged is_error (fail closed)', () => {
  const state = fixtureState([
    asstBash('2026-07-06T10:00:00.000Z', 't1', 'npm run build'),
    toolResult('2026-07-06T10:00:30.000Z', 't1', false, OK_RESULT),
    endTurn('2026-07-06T10:01:00.000Z'),
  ]);
  expect(errorsOf(buildEvents(state, 'p_00000000', NOW))).toHaveLength(0);
});

it('ignores is_error on non-Bash tools (e.g. a failed Read)', () => {
  const state = fixtureState([
    { type: 'assistant', timestamp: '2026-07-06T10:00:00.000Z', message: { model: 'claude-opus-4-8', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x/y' } }] } },
    toolResult('2026-07-06T10:00:10.000Z', 'r1', true, 'File does not exist'),
    endTurn('2026-07-06T10:01:00.000Z'),
  ]);
  expect(errorsOf(buildEvents(state, 'p_00000000', NOW))).toHaveLength(0);
});

it('omits ended_by on a preview build but sets it on a finalized one', () => {
  const state = fixtureState([endTurn('2026-07-06T10:00:00.000Z')]);
  const preview = buildEvents(state, 'p_0', NOW, { preview: true }).find((e) => e.type === 'session');
  const real = buildEvents(state, 'p_0', NOW).find((e) => e.type === 'session');
  expect(preview).toBeDefined();
  expect('ended_by' in (preview as object)).toBe(false);
  expect(real?.ended_by).toBe('agent');
});
