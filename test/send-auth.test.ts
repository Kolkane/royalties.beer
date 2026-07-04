// The sender attaches the bearer token, drains the queue on success, and reacts
// correctly to 401 (drop token, keep queue) and 429 (keep queue + token).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flush } from '../src/send.js';
import { getAuth, saveToken } from '../src/panelist.js';
import { appendLine, readLines } from '../src/queue.js';
import { paths } from '../src/config.js';
import { resetAll } from './util.js';

beforeEach(() => {
  resetAll();
  saveToken('p_00000000', 'tok_secret'); // already registered
  appendLine(paths.queue, '{"type":"error"}'); // one pending line
});
afterEach(() => {
  vi.restoreAllMocks();
  resetAll();
});

it('sends with a bearer header and drains the queue on 202', async () => {
  let authHeader = '';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      authHeader = init.headers.authorization;
      return new Response('{"accepted":1}', { status: 202 });
    }),
  );

  const result = await flush(2000);
  expect(authHeader).toBe('Bearer tok_secret');
  expect(result.ok).toBe(true);
  expect(readLines(paths.queue)).toHaveLength(0);
});

it('keeps the queue and drops the token on 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
  const result = await flush(2000);
  expect(result.ok).toBe(false);
  expect(readLines(paths.queue)).toHaveLength(1); // kept for retry
  expect(getAuth()).toBeNull(); // token cleared, will re-register
});

it('keeps the queue and the token on 429', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
  await flush(2000);
  expect(readLines(paths.queue)).toHaveLength(1);
  expect(getAuth()).not.toBeNull();
});
