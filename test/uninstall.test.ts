// init installs hooks non-destructively; uninstall restores settings.json byte
// for byte.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { install, isInstalled, uninstall } from '../src/hooks/install.js';
import { CLAUDE_SETTINGS_PATH } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

// Deliberately idiosyncratic formatting (4-space indent, an existing hook, extra
// keys) so a byte-identical restore proves we don't reformat the user's file.
const ORIGINAL = `{
    "model": "opus",
    "hooks": {
        "PostToolUse": [
            {
                "matcher": "Bash",
                "hooks": [ { "type": "command", "command": "echo hi" } ]
            }
        ]
    }
}
`;

function writeOriginal(): void {
  mkdirSync(dirname(CLAUDE_SETTINGS_PATH), { recursive: true });
  writeFileSync(CLAUDE_SETTINGS_PATH, ORIGINAL);
}

it('installs non-destructively and preserves existing hooks', () => {
  writeOriginal();
  install();
  const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
  expect(isInstalled(settings)).toBe(true);
  // the user's existing echo hook is still there
  const post = settings.hooks.PostToolUse as unknown[];
  expect(JSON.stringify(post)).toContain('echo hi');
  // our three events are present
  expect(settings.hooks.SessionStart).toBeDefined();
  expect(settings.hooks.Stop).toBeDefined();
});

it('uninstall restores the file byte-identical', () => {
  writeOriginal();
  const before = readFileSync(CLAUDE_SETTINGS_PATH);
  install();
  expect(readFileSync(CLAUDE_SETTINGS_PATH).equals(before)).toBe(false); // it changed
  uninstall();
  expect(readFileSync(CLAUDE_SETTINGS_PATH).equals(before)).toBe(true); // and was restored exactly
});

it('when no settings file existed, uninstall removes the one we created', () => {
  expect(existsSync(CLAUDE_SETTINGS_PATH)).toBe(false);
  install();
  expect(existsSync(CLAUDE_SETTINGS_PATH)).toBe(true);
  uninstall();
  expect(existsSync(CLAUDE_SETTINGS_PATH)).toBe(false);
});

it('is idempotent — installing twice does not duplicate our hooks', () => {
  writeOriginal();
  install();
  const first = install(); // second call
  expect(first.alreadyInstalled).toBe(true);
  const settings = JSON.parse(readFileSync(CLAUDE_SETTINGS_PATH, 'utf8'));
  expect((settings.hooks.SessionStart as unknown[]).length).toBe(1);
});
