// The send path must dequeue EXACTLY ONCE, only after a confirmed 2xx, without
// clobbering a line another hook appended concurrently; and every event carries
// a client event_id so a re-send is a server-side no-op (the backend upserts).
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flush } from '../src/send.js';
import { finalize } from '../src/finalize.js';
import { saveToken } from '../src/panelist.js';
import { appendLine, readEvents, readLines } from '../src/queue.js';
import { paths } from '../src/config.js';
import type { SessionState } from '../src/state.js';
import { resetAll } from './util.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const L1 = '{"event_id":"11111111-1111-4111-8111-111111111111","type":"api_domain_used","domain":"api.stripe.com"}';
const L2 = '{"event_id":"22222222-2222-4222-8222-222222222222","type":"api_domain_used","domain":"api.resend.com"}';
const L3 = '{"event_id":"33333333-3333-4333-8333-333333333333","type":"api_domain_used","domain":"api.openai.com"}';

beforeEach(() => {
  resetAll();
  saveToken('p_00000000', 'tok_secret'); // registered, so flush proceeds to send
});
afterEach(() => {
  vi.restoreAllMocks();
  resetAll();
});

it('send-confirmed-dequeue: removes exactly the sent events after a 2xx, preserving a concurrent append', async () => {
  appendLine(paths.queue, L1);
  appendLine(paths.queue, L2);

  // Another hook appends L3 to the shared queue DURING the network round-trip.
  // The OLD code overwrote the queue with a stale snapshot and lost L3; the fix
  // removes only the sent lines from the current file, so L3 survives and ships.
  const bodies: string[] = [];
  let appended = false;
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    bodies.push(init.body);
    if (!appended) { appendLine(paths.queue, L3); appended = true; }
    return new Response('{}', { status: 202 });
  }));

  const res = await flush(2000);

  expect(readLines(paths.queue)).toHaveLength(0); // fully drained
  expect(bodies.join(',')).toContain(L3); // concurrent append was SENT, not clobbered
  expect(res.ok).toBe(true);
});

it('send-confirmed-dequeue: a persisted dequeue is not re-sent on the next flush', async () => {
  appendLine(paths.queue, L1);
  const fetchMock = vi.fn(async () => new Response('{}', { status: 202 }));
  vi.stubGlobal('fetch', fetchMock);

  await flush(2000);
  expect(readLines(paths.queue)).toHaveLength(0);
  expect(fetchMock).toHaveBeenCalledOnce();

  await flush(2000); // queue empty now -> no second send, no duplicate
  expect(fetchMock).toHaveBeenCalledOnce();
});

it('retry-after-network-error re-sends the SAME event_id', async () => {
  appendLine(paths.queue, L1);

  // attempt 1: network error -> nothing sent, nothing dequeued
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw new Error('offline');
  }));
  await flush(150);
  expect(readLines(paths.queue)).toEqual([L1]); // still queued, untouched

  // attempt 2: succeeds; the retried delivery carries the identical event_id
  let sentBody = '';
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
    sentBody = init.body;
    return new Response('{}', { status: 202 });
  }));
  await flush(2000);
  expect(readLines(paths.queue)).toHaveLength(0);
  const posted = JSON.parse(sentBody) as { events: { event_id: string }[] };
  expect(posted.events[0].event_id).toBe('11111111-1111-4111-8111-111111111111');
});

it('no dequeue on 5xx: events stay queued for a later retry', async () => {
  appendLine(paths.queue, L1);
  appendLine(paths.queue, L2);
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"internal"}', { status: 503 })));

  const res = await flush(150);
  expect(readLines(paths.queue)).toEqual([L1, L2]); // nothing removed
  expect(res.ok).toBe(false);
});

it('finalize stamps a distinct UUID v4 event_id on every queued event', () => {
  const state: SessionState = {
    session_id: 's',
    transcript_path: '/does/not/exist',
    cwd: '/x',
    started_at: 0,
    updated_at: 0,
    deps: [{ ecosystem: 'npm', package: 'resend' }, { ecosystem: 'npm', package: 'zod' }],
    domains: [],
  };
  const n = finalize(state, 'p_8f3a1b2c9d4e5f60', Date.parse('2026-07-04T10:00:00.000Z'));
  expect(n).toBe(2);
  const ids = readEvents(paths.queue).map((e) => e.event_id as string);
  for (const id of ids) expect(id).toMatch(UUID_V4);
  expect(new Set(ids).size).toBe(2); // a distinct key per event
});
