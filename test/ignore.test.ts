// A project with a .royaltiesignore file produces zero events and zero state.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleHook } from '../src/hooks/handle.js';
import { listStates } from '../src/state.js';
import { readLines } from '../src/queue.js';
import { paths } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

it('emits nothing from an ignored project', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'royalties-ignored-'));
  writeFileSync(join(dir, '.royaltiesignore'), '');
  const transcript = join(dir, 't.jsonl');
  writeFileSync(transcript, '');

  const base = { session_id: 's-ignored', transcript_path: transcript, cwd: dir };
  await handleHook({ ...base, hook_event_name: 'SessionStart' });
  await handleHook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm install resend@4.0.0' }, bash_exit_code: 1 });
  await handleHook({ ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: 'a.ts', content: 'fetch("https://api.stripe.com")' } });
  await handleHook({ ...base, hook_event_name: 'Stop' });

  expect(listStates()).toHaveLength(0);
  expect(readLines(paths.queue)).toHaveLength(0);
  expect(readLines(paths.log)).toHaveLength(0);
});
