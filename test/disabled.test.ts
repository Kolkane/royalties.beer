// The `disabled` tombstone is the persistent opt-out: `purge` and `uninstall`
// drop it so any Claude Code session still running with our hooks goes inert
// immediately, and only `init` clears it (the explicit opt back in).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { cmdInit, cmdPurge, cmdResume, cmdUninstall } from '../src/commands.js';
import { disableCollector, enableCollector, isDisabled } from '../src/ignore.js';
import { CLAUDE_SETTINGS_PATH, paths } from '../src/config.js';
import { resetAll } from './util.js';

const logs: string[] = [];

beforeEach(() => {
  resetAll();
  logs.length = 0;
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
  // No command in these tests should reach the network; make sure of it.
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('offline');
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  resetAll();
});

it('disableCollector / enableCollector / isDisabled round-trip', () => {
  expect(isDisabled()).toBe(false);
  disableCollector();
  expect(isDisabled()).toBe(true);
  expect(existsSync(paths.disabled)).toBe(true);
  enableCollector();
  expect(isDisabled()).toBe(false);
  expect(existsSync(paths.disabled)).toBe(false);
});

it('uninstall drops the tombstone', () => {
  cmdUninstall();
  expect(isDisabled()).toBe(true);
});

it('purge drops the tombstone', async () => {
  await cmdPurge();
  expect(isDisabled()).toBe(true);
});

it('init clears a tombstone left by a prior purge/uninstall', async () => {
  disableCollector();
  expect(isDisabled()).toBe(true);
  await cmdInit();
  expect(isDisabled()).toBe(false);
});

it('purge and uninstall warn that already-running sessions keep their hooks', async () => {
  cmdUninstall();
  await cmdPurge();
  const running = logs.filter((l) => l.includes('sessions already running keep their hooks until restarted'));
  expect(running.length).toBe(2); // printed by BOTH commands
});

it('uninstall still drops the tombstone when settings.json is corrupt (uninstall throws)', () => {
  // uninstall() refuses to touch invalid JSON and throws; the tombstone must
  // still be written so a still-running session goes inert regardless.
  mkdirSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, '{ not valid json');
  expect(() => cmdUninstall()).toThrow();
  expect(isDisabled()).toBe(true);
});

it('resume does not falsely claim "Resumed." while a tombstone is present', () => {
  disableCollector();
  cmdResume();
  expect(logs.some((l) => l.includes('Run `royalties init` to re-enable'))).toBe(true);
  expect(logs).not.toContain('Resumed.');
  expect(isDisabled()).toBe(true); // resume did not clear the tombstone
});
