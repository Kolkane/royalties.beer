// Install-path durability: `init` copies the compiled CLI into a stable dir we
// own (~/.royalties/bin) and points the hooks there, so they never reference
// npm's evictable _npx cache. And the hook runtime self-heals: if it is invoked
// from a path the installed hooks no longer reference, it no-ops instead of
// collecting from a superseded copy.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hookCommand, install, installedHookCliPath, isSupersededHookRuntime, runningHookCliPath, uninstall } from '../src/hooks/install.js';
import { handleHook } from '../src/hooks/handle.js';
import { getPanelistId } from '../src/panelist.js';
import { listStates } from '../src/state.js';
import { CLAUDE_SETTINGS_PATH, paths } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

const fwd = (p: string): string => p.replace(/\\/g, '/');

function writeHookSettings(command: string): void {
  mkdirSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  const entry = { hooks: [{ type: 'command', command }] };
  writeFileSync(
    CLAUDE_SETTINGS_PATH,
    JSON.stringify({ hooks: { SessionStart: [entry], PostToolUse: [entry], Stop: [entry], SessionEnd: [entry] } }, null, 2) + '\n',
  );
}

function allHookCommands(): string[] {
  const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf8')) as { hooks?: Record<string, { hooks?: { command?: string }[] }[]> };
  const out: string[] = [];
  for (const arr of Object.values(settings.hooks ?? {})) {
    for (const entry of arr) for (const h of entry.hooks ?? []) if (typeof h.command === 'string' && h.command.includes('__hook')) out.push(h.command);
  }
  return out;
}

it('init copies the CLI into ~/.royalties/bin and points the hooks there', () => {
  const result = install();
  // The hook command references the stable bin under ROYALTIES_HOME, not the source.
  expect(fwd(result.command)).toContain(fwd(join(paths.bin, 'dist', 'cli.js')));
  expect(existsSync(join(paths.bin, 'dist', 'cli.js'))).toBe(true);
  expect(existsSync(join(paths.bin, 'package.json'))).toBe(true);
  // settings.json carries exactly that command, on every event.
  const cmds = allHookCommands();
  expect(cmds.length).toBe(4);
  for (const c of cmds) expect(c).toBe(result.command);
});

it('uninstall removes the stable bin copy', () => {
  install();
  expect(existsSync(paths.bin)).toBe(true);
  uninstall();
  expect(existsSync(paths.bin)).toBe(false);
});

it('re-init migrates a hook pointing into an evicted npx cache to the stable bin', () => {
  writeHookSettings('node "/tmp/npm-cache/_npx/abc123/node_modules/royalties/dist/cli.js" __hook');
  const result = install();
  expect(fwd(result.command)).toContain(fwd(paths.bin));
  const cmds = allHookCommands();
  expect(cmds.length).toBeGreaterThan(0);
  for (const c of cmds) {
    expect(c).toBe(result.command); // migrated to the stable bin
    expect(c).not.toContain('_npx'); // no stale cache path remains
  }
});

it('re-init is idempotent once the hooks already point at the stable bin', () => {
  const first = install();
  const second = install();
  expect(second.alreadyInstalled).toBe(true);
  expect(allHookCommands().every((c) => c === first.command)).toBe(true);
});

it('self-heal: not superseded when the installed command references this runtime', () => {
  writeHookSettings(hookCommand(runningHookCliPath()));
  expect(installedHookCliPath()).toBe(runningHookCliPath());
  expect(isSupersededHookRuntime()).toBe(false);
});

it('self-heal: superseded when the installed command points at another cli.js', () => {
  writeHookSettings('node "/somewhere/else/royalties/dist/cli.js" __hook');
  expect(isSupersededHookRuntime()).toBe(true);
});

it('self-heal: no installed hooks -> not superseded (a normal run is never blocked)', () => {
  expect(isSupersededHookRuntime()).toBe(false);
});

it('self-heal: the hook writes NOTHING when running from a superseded path', async () => {
  getPanelistId(); // identity exists...
  writeHookSettings('node "/evicted/royalties/dist/cli.js" __hook'); // ...but hooks point elsewhere
  await handleHook({ hook_event_name: 'SessionStart', session_id: 's', cwd: '/x', transcript_path: '' });
  expect(listStates()).toHaveLength(0); // superseded copy -> no state written
});

it('the hook collects normally when the installed command references this runtime', async () => {
  getPanelistId();
  writeHookSettings(hookCommand(runningHookCliPath())); // hooks point at us
  await handleHook({ hook_event_name: 'SessionStart', session_id: 's', cwd: '/x', transcript_path: '' });
  expect(listStates()).toHaveLength(1); // matches -> collects
});
