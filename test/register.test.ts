// Registration obtains and stores a bearer token, is idempotent, recovers from a
// 409, and stays offline-safe.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ensureRegistered, register } from '../src/register.js';
import { getAuth, peekPanelistId } from '../src/panelist.js';
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

it('recovers from a 409 by rotating to a fresh panelist id', async () => {
  let calls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: string }) => {
      calls++;
      if (calls === 1) return new Response('{"error":"panelist already registered"}', { status: 409 });
      const body = JSON.parse(init.body) as { panelist_id: string };
      return new Response(JSON.stringify({ panelist_id: body.panelist_id, token: 'tok_new' }), { status: 201 });
    }),
  );

  const auth = await register();
  expect(auth?.token).toBe('tok_new');
  expect(auth?.panelistId).toBe(peekPanelistId());
  expect(calls).toBe(2);
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
