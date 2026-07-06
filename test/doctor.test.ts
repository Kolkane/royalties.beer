// `royalties doctor` surfaces stuck auth explicitly — a registered id whose
// token the server rejects and won't re-issue — instead of failing silently.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cmdDoctor } from '../src/commands.js';
import { getPanelistId, markRegisterConflict, saveToken } from '../src/panelist.js';
import { resetAll } from './util.js';

const logs: string[] = [];

beforeEach(() => {
  resetAll();
  logs.length = 0;
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
    logs.push(a.map(String).join(' '));
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  resetAll();
});

it('warns about stuck auth and points to @royaltiesdev', () => {
  getPanelistId(); // a registered id...
  markRegisterConflict(); // ...whose token the server 409-rejected.
  cmdDoctor();
  const out = logs.join('\n');
  expect(out).toMatch(/stuck auth/i);
  expect(out).toContain('@royaltiesdev');
});

it('does not warn when auth is healthy (token held)', () => {
  const id = getPanelistId();
  saveToken(id, 'tok_ok');
  cmdDoctor();
  expect(logs.join('\n')).not.toMatch(/stuck auth/i);
});

it('does not warn when merely unregistered (no conflict yet)', () => {
  getPanelistId(); // id but no token, and no 409 seen
  cmdDoctor();
  expect(logs.join('\n')).not.toMatch(/stuck auth/i);
});
