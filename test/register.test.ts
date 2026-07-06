// Registration obtains and stores a bearer token, is idempotent, NEVER forks the
// panelist id on a 409, never MINTS an id (only `init` does), and is offline-safe.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';
import { ensureRegistered, register } from '../src/register.js';
import { getAuth, getPanelistId, isAuthStuck, peekPanelistId } from '../src/panelist.js';
import { REGISTER_ENDPOINT, paths } from '../src/config.js';
import { resetAll } from './util.js';

// An identity always exists before registration in reality: `init` creates it,
// then registers. Establish one so these tests exercise the real precondition.
beforeEach(() => {
  resetAll();
  getPanelistId();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetAll();
});

function ok201() {
  // Echo the requested panelist_id back with a token, like the real server.
  return vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { panelist_id: string };
    return new Response(JSON.stringify({ panelist_id: body.panelist_id, token: 'tok_abc' }), { status: 201 });
  });
}

it('registers and stores the token', async () => {
  const fetchMock = ok201();
  vi.stubGlobal('fetch', fetchMock);

  const auth = await register();
  expect(auth?.token).toBe('tok_abc');
  expect(getAuth()?.token).toBe('tok_abc');
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][0]).toBe(REGISTER_ENDPOINT);
});

it('ensureRegistered reuses a stored token without a second call', async () => {
  const fetchMock = ok201();
  vi.stubGlobal('fetch', fetchMock);

  await ensureRegistered();
  await ensureRegistered();
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('NEVER forks the panelist id on a 409 — keeps the id, stores no token', async () => {
  const idBefore = getPanelistId(); // establish a stable identity first
  const fetchMock = vi.fn(async () => new Response('{"error":"panelist already registered"}', { status: 409 }));
  vi.stubGlobal('fetch', fetchMock);

  const auth = await register();
  expect(auth).toBeNull(); // no token obtained
  expect(getAuth()).toBeNull(); // nothing stored
  expect(peekPanelistId()).toBe(idBefore); // SAME id — not rotated
  expect(fetchMock).toHaveBeenCalledOnce(); // no second (rotate) attempt
  expect(isAuthStuck()).toBe(true); // flagged so `royalties doctor` can surface it
});

it('binds the token to OUR id, ignoring a different id echoed by the server', async () => {
  const idBefore = getPanelistId();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ panelist_id: 'p_SERVER_DIFFERENT', token: 'tok_z' }), { status: 201 })));

  const auth = await register();
  expect(auth?.panelistId).toBe(idBefore); // our id, not the server's
  expect(peekPanelistId()).toBe(idBefore);
  expect(getAuth()).toEqual({ panelistId: idBefore, token: 'tok_z' });
});

it('returns null and stores no token when offline', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('network down');
  }));
  expect(await register()).toBeNull();
  expect(getAuth()).toBeNull();
});

it('never mints an identity when none exists — returns null, writes nothing, no network', async () => {
  // Simulate a concurrent `purge` having deleted panelist.json after a hook's
  // entry guard passed but before its flush -> register ran.
  rmSync(paths.panelist, { force: true });
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'tok_resurrect' }), { status: 201 }));
  vi.stubGlobal('fetch', fetchMock);

  expect(await register()).toBeNull();
  expect(peekPanelistId()).toBeNull(); // id NOT resurrected on disk
  expect(getAuth()).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled(); // never even attempted to register
});

it('gives up quietly on a 403 (invite required) — not flagged as stuck auth', async () => {
  getPanelistId();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invite"}', { status: 403 })));
  expect(await register()).toBeNull();
  expect(getAuth()).toBeNull();
  expect(isAuthStuck()).toBe(false); // 403 is recoverable (invite), not stuck
});
