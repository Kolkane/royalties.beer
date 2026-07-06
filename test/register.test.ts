// Registration obtains and stores a bearer token, is idempotent, NEVER forks the
// panelist id on a 409, and stays offline-safe.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureRegistered, register } from '../src/register.js';
import { getAuth, getPanelistId, peekPanelistId } from '../src/panelist.js';
import { REGISTER_ENDPOINT } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
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

it('gives up quietly on a 403 (invite required)', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invite"}', { status: 403 })));
  expect(await register()).toBeNull();
  expect(getAuth()).toBeNull();
});
