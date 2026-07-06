// The hook runtime is a strict no-op unless the user opted in via `royalties
// init`. In two cases it must write NOTHING at all — no identity, no session
// state, no queue, no runtime marker:
//   (a) no identity yet (never init-ed): only `init` may create identity/state;
//   (b) the `disabled` tombstone is present (purge/uninstall dropped it), even
//       though an identity still exists — a Claude Code session still running
//       with our hooks installed goes inert immediately.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { handleHook } from '../src/hooks/handle.js';
import { getPanelistId, peekPanelistId } from '../src/panelist.js';
import { disableCollector, enableCollector } from '../src/ignore.js';
import { listStates } from '../src/state.js';
import { readLines } from '../src/queue.js';
import { paths } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

const SESSION_START = { hook_event_name: 'SessionStart', session_id: 's-inert', cwd: '', transcript_path: '' };
const POST_BASH = {
  hook_event_name: 'PostToolUse',
  session_id: 's-inert',
  tool_name: 'Bash',
  tool_input: { command: 'npm install left-pad' },
  cwd: '',
};

/** Drive a representative slice of the hook lifecycle. */
async function driveHooks(): Promise<void> {
  await handleHook(SESSION_START as never);
  await handleHook(POST_BASH as never);
  await handleHook({ ...SESSION_START, hook_event_name: 'SessionEnd' } as never);
}

it('writes nothing when no identity exists (never init-ed)', async () => {
  // resetAll leaves an empty home with NO panelist.json.
  expect(readdirSync(paths.home)).toHaveLength(0);

  await driveHooks();

  expect(peekPanelistId()).toBeNull(); // identity NOT created by the hook
  expect(listStates()).toHaveLength(0); // no session state
  expect(readLines(paths.queue)).toHaveLength(0); // nothing queued
  expect(existsSync(paths.runtime)).toBe(false); // no runtime marker
  expect(readdirSync(paths.home)).toHaveLength(0); // zero files written, period
});

it('writes nothing when the disabled tombstone is present', async () => {
  getPanelistId(); // an identity exists (init-ed once)...
  disableCollector(); // ...but purge/uninstall dropped the tombstone.
  const before = readdirSync(paths.home).sort();

  await driveHooks();

  expect(listStates()).toHaveLength(0); // hot path never ran
  expect(readLines(paths.queue)).toHaveLength(0);
  expect(existsSync(paths.runtime)).toBe(false); // recordRuntime never fired
  expect(readdirSync(paths.home).sort()).toEqual(before); // no new files at all
});

it('resumes collecting once the tombstone is cleared (opt back in)', async () => {
  getPanelistId();
  disableCollector();
  enableCollector(); // what `init` does

  await handleHook(SESSION_START as never);
  await handleHook(POST_BASH as never);

  expect(listStates()).toHaveLength(1); // hot path ran again
  expect(existsSync(paths.runtime)).toBe(true); // runtime marker recorded
});
