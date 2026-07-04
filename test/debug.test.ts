// The debug snapshot records field NAMES + the Bash exit code only, and only
// when ROYALTIES_DEBUG=1.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readHookDebug, recordHookDebug, type HookDebug } from '../src/debug.js';
import { resetAll } from './util.js';

const snapshot: HookDebug = {
  at: '2026-07-04T10:00:00.000Z',
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  top_level_keys: ['bash_exit_code', 'cwd', 'session_id', 'tool_input', 'tool_name'],
  tool_input_keys: ['command'],
  exit_code_found: true,
  exit_code: 1,
  exit_code_source: 'bash_exit_code',
};

beforeEach(() => {
  resetAll();
  delete process.env.ROYALTIES_DEBUG;
});
afterEach(() => {
  delete process.env.ROYALTIES_DEBUG;
});

it('writes nothing when debug is off', () => {
  recordHookDebug(snapshot);
  expect(readHookDebug()).toBeNull();
});

it('records field names + exit code when ROYALTIES_DEBUG=1', () => {
  process.env.ROYALTIES_DEBUG = '1';
  recordHookDebug(snapshot);
  const read = readHookDebug();
  expect(read).toEqual(snapshot);
  // it stores names, never a raw command string
  expect(read?.tool_input_keys).toEqual(['command']);
  expect(JSON.stringify(read)).not.toContain('npm');
});
