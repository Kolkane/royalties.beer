// The debug snapshot records field NAMES (incl. tool_response) + the Bash exit
// code only, keeps one record per tool_name, and only when ROYALTIES_DEBUG=1.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readHookDebug, recordHookDebug, type HookDebug } from '../src/debug.js';
import { resetAll } from './util.js';

const snapshot: HookDebug = {
  at: '2026-07-04T10:00:00.000Z',
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  top_level_keys: ['cwd', 'session_id', 'tool_input', 'tool_name', 'tool_response'],
  tool_input_keys: ['command'],
  tool_response_keys: ['interrupted', 'stderr', 'stdout'],
  exit_code_found: false,
  exit_code: null,
  exit_code_source: null,
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

it('records field names keyed by tool_name when ROYALTIES_DEBUG=1', () => {
  process.env.ROYALTIES_DEBUG = '1';
  recordHookDebug(snapshot);
  const read = readHookDebug();
  expect(read?.['Bash']).toEqual(snapshot);
  // it stores names, never a raw command string
  expect(read?.['Bash'].tool_input_keys).toEqual(['command']);
  expect(JSON.stringify(read)).not.toContain('npm');
});

it('keeps the last payload per tool_name, not just the last overall', () => {
  process.env.ROYALTIES_DEBUG = '1';
  recordHookDebug(snapshot); // Bash
  recordHookDebug({ ...snapshot, tool_name: 'Write', tool_input_keys: ['content', 'file_path'], tool_response_keys: ['filePath', 'type'] });
  const read = readHookDebug();
  expect(Object.keys(read ?? {}).sort()).toEqual(['Bash', 'Write']);
  expect(read?.['Bash'].tool_input_keys).toEqual(['command']);
  expect(read?.['Write'].tool_input_keys).toEqual(['content', 'file_path']);
});
