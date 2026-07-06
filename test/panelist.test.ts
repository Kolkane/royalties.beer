// Identity stability is critical (payouts depend on it): the panelist id must
// never change once created, and a second process must adopt the existing id
// rather than mint a divergent one.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { createPanelist, getAuth, getPanelistId, peekPanelistId, saveToken } from '../src/panelist.js';
import { paths } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

it('getPanelistId is stable across calls', () => {
  const a = getPanelistId();
  const b = getPanelistId();
  expect(a).toBe(b);
  expect(peekPanelistId()).toBe(a);
});

it('createPanelist never overwrites an established identity — it adopts it', () => {
  const first = getPanelistId(); // creates panelist.json
  const raw = readFileSync(paths.panelist, 'utf8');

  const second = createPanelist(); // a racing/second process
  expect(second).toBe(first); // same id, not a fork
  expect(peekPanelistId()).toBe(first);
  expect(readFileSync(paths.panelist, 'utf8')).toBe(raw); // file untouched
});

it('clearToken preserves the id (a rejected token never changes identity)', () => {
  const id = getPanelistId();
  saveToken(id, 'tok_x');
  expect(getAuth()).toEqual({ panelistId: id, token: 'tok_x' });

  // simulate a 401 wiping the token
  const p = JSON.parse(readFileSync(paths.panelist, 'utf8')) as { panelist_id: string; token?: string };
  delete p.token;
  writeFileSync(paths.panelist, JSON.stringify(p));

  expect(getAuth()).toBeNull(); // no token
  expect(peekPanelistId()).toBe(id); // but SAME id
  expect(getPanelistId()).toBe(id); // and re-resolving does not mint a new one
});
