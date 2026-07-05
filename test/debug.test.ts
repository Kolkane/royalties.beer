// The debug snapshot records field NAMES (incl. tool_response) + the Bash exit
// code only, keeps one record per tool_name, and only when ROYALTIES_DEBUG=1.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { isHookDebug, readHookDebug, recordHookDebug, type HookDebug } from '../src/debug.js';
import { paths } from '../src/config.js';
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

it('migrates a legacy 0.2.0 single-record debug file instead of crashing', () => {
  process.env.ROYALTIES_DEBUG = '1';
  // 0.2.0 stored ONE record (no per-tool map, no `tool_response_keys`).
  mkdirSync(paths.home, { recursive: true });
  const legacy = { at: '2026-07-04T09:00:00.000Z', hook_event_name: 'PostToolUse', tool_name: 'Bash', top_level_keys: ['bash_exit_code'], tool_input_keys: ['command'], exit_code_found: true, exit_code: 0, exit_code_source: 'bash_exit_code' };
  writeFileSync(paths.debug, JSON.stringify(legacy, null, 2));

  const read = readHookDebug();
  expect(read?.['Bash']?.at).toBe('2026-07-04T09:00:00.000Z'); // wrapped by tool_name
  // and a new record merges cleanly rather than throwing
  recordHookDebug({ ...snapshot, tool_name: 'Write' });
  expect(Object.keys(readHookDebug() ?? {}).sort()).toEqual(['Bash', 'Write']);
});

it('isHookDebug rejects legacy/garbage values', () => {
  expect(isHookDebug({ at: '2026-01-01', top_level_keys: [] })).toBe(true);
  expect(isHookDebug('2026-01-01')).toBe(false); // a bare string (a legacy field value)
  expect(isHookDebug(null)).toBe(false);
  expect(isHookDebug({ nope: 1 })).toBe(false); // no string `at`
});
