// End-to-end hot path: hooks accumulate whitelisted observations into session
// state, and finalizing turns them into valid events. No network is touched.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleHook } from '../src/hooks/handle.js';
import { finalize } from '../src/finalize.js';
import { loadState, listStates } from '../src/state.js';
import { peekPanelistId } from '../src/panelist.js';
import { isAllowed } from '../src/serialize.js';
import { readEvents, readLines } from '../src/queue.js';
import { paths } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

it('accumulates deps, domains and errors, then finalizes to valid events', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'royalties-proj-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '14.0.0' } }));
  writeFileSync(join(dir, 'tsconfig.json'), '{}');

  const base = { session_id: 's1', transcript_path: join(dir, 'missing.jsonl'), cwd: dir };
  await handleHook({ ...base, hook_event_name: 'SessionStart' });
  await handleHook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm install resend@4.0.0' }, bash_exit_code: 0 });
  await handleHook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' }, bash_exit_code: 1 });
  await handleHook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'client.ts', content: 'fetch("https://api.stripe.com/v1/charges")' } });
  await handleHook({ ...base, hook_event_name: 'Stop' });

  // Fresh session: accumulated but not yet queued.
  expect(listStates()).toHaveLength(1);
  expect(readLines(paths.queue)).toHaveLength(0);

  const state = loadState('s1');
  expect(state?.language).toBe('typescript');
  expect(state?.framework).toBe('nextjs');
  expect(state?.deps).toContainEqual({ ecosystem: 'npm', package: 'resend', version: '4.0.0' });
  expect(state?.domains).toContain('api.stripe.com');

  // Finalize explicitly and check the resulting events are all whitelisted.
  finalize(state!, peekPanelistId() ?? 'p_00000000', Date.now());
  const events = readEvents(paths.queue);
  const types = events.map((e) => e.type);
  expect(types).toContain('dependency_added');
  expect(types).toContain('api_domain_used');
  expect(types).toContain('error');
  expect(events.find((e) => e.type === 'dependency_added')?.package).toBe('resend');
  expect(events.find((e) => e.type === 'api_domain_used')?.domain).toBe('api.stripe.com');
  expect(events.find((e) => e.type === 'error')?.category).toBe('test');
  for (const event of events) expect(isAllowed(event)).toBe(true);
});
