// The sender attaches the bearer token, drains the queue on success, and reacts
// correctly to 401 (drop the token ONLY on a definitive {"error":"unknown_token"};
// keep it on any other 401) and 429 (keep queue + token).
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

it('keeps the queue AND the token on a transient 401 (body is not unknown_token)', async () => {
  // A proxy/auth blip: keep the token and retry later. Dropping it would force a
  // re-register that, on a 409, would strand the identity as stuck auth.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"temporarily_unavailable"}', { status: 401 })));
  const result = await flush(2000);
  expect(result.ok).toBe(false);
  expect(readLines(paths.queue)).toHaveLength(1); // kept for retry
  expect(getAuth()).not.toBeNull(); // token PRESERVED
});

it('keeps the token on a 401 with an empty or unparseable body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 401 })));
  await flush(2000);
  expect(readLines(paths.queue)).toHaveLength(1);
  expect(getAuth()).not.toBeNull(); // unparseable != definitive rejection -> keep it
});

it('drops the token ONLY on a definitive {"error":"unknown_token"} 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"unknown_token"}', { status: 401 })));
  const result = await flush(2000);
  expect(result.ok).toBe(false);
  expect(readLines(paths.queue)).toHaveLength(1); // kept for retry
  expect(getAuth()).toBeNull(); // token cleared, will re-register
});

it('keeps the token on a 401 with an empty body', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
  await flush(2000);
  expect(readLines(paths.queue)).toHaveLength(1);
  expect(getAuth()).not.toBeNull(); // empty body != definitive rejection -> keep it
});

it('keeps the queue and the token on 429', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 429 })));
  await flush(2000);
  expect(readLines(paths.queue)).toHaveLength(1);
  expect(getAuth()).not.toBeNull();
});

it('keeps the queue and the token on a 5xx server outage', async () => {
  // Requirement: all 5xx are transient. A routine outage must never cost a valid
  // token (that would force a re-register a 409 could strand as stuck auth).
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"internal"}', { status: 503 })));
  const result = await flush(300); // short deadline so the retry/backoff bails fast
  expect(result.ok).toBe(false);
  expect(readLines(paths.queue)).toHaveLength(1); // kept for retry
  expect(getAuth()).not.toBeNull(); // token PRESERVED
});
