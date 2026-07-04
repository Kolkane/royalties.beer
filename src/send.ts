// The one and only network path. Registers (once) to obtain a bearer token, then
// sends batches of already-validated events with that token and exponential
// backoff. Offline-safe: on any failure the events stay in the queue for a later
// attempt, and nothing here ever throws.
import { EVENTS_ENDPOINT, PURGE_ENDPOINT, SEND_BATCH, paths } from './config.js';
import { readLines, writeLines } from './queue.js';
import { clearToken, getAuth } from './panelist.js';
import { ensureRegistered } from './register.js';

export interface SendResult {
  sent: number;
  remaining: number;
  ok: boolean;
}

/** Flush pending events. Time-boxed so it can safely run inside a hook. */
export async function flush(maxMs = 8000): Promise<SendResult> {
  const deadline = Date.now() + maxMs;
  let pending = readLines(paths.queue);
  if (pending.length === 0) return { sent: 0, remaining: 0, ok: true };

  const auth = await ensureRegistered();
  if (!auth) return { sent: 0, remaining: pending.length, ok: false }; // offline / not registered yet

  let sent = 0;
  while (pending.length > 0 && Date.now() < deadline) {
    const batch = pending.slice(0, SEND_BATCH);
    const outcome = await postBatch(batch, auth.token, deadline);
    if (outcome === 'unauthorized') {
      clearToken(); // token rejected — re-register on the next flush
      break;
    }
    if (outcome !== 'ok') break; // rate-limited / client error / offline → keep queued
    sent += batch.length;
    pending = pending.slice(batch.length);
    writeLines(paths.queue, pending); // persist progress after every accepted batch
  }
  return { sent, remaining: pending.length, ok: pending.length === 0 };
}

type Outcome = 'ok' | 'unauthorized' | 'rate-limited' | 'error';

async function postBatch(lines: string[], token: string, deadline: number): Promise<Outcome> {
  const body = `{"events":[${lines.join(',')}]}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (Date.now() >= deadline) return 'error';
    try {
      const res = await fetch(EVENTS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(Math.max(500, Math.min(4000, deadline - Date.now()))),
      });
      if (res.ok) return 'ok';
      if (res.status === 401) return 'unauthorized';
      if (res.status === 429) return 'rate-limited';
      if (res.status < 500) return 'error'; // client error: leave queued, don't hammer
    } catch {
      // offline / timeout: fall through to backoff and retry
    }
    await sleep(Math.min(2000, 200 * 2 ** attempt));
  }
  return 'error';
}

/** Ask the server to erase this panelist's data (best-effort). */
export async function requestServerPurge(panelistId: string): Promise<boolean> {
  const auth = getAuth();
  try {
    const res = await fetch(PURGE_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(auth ? { authorization: `Bearer ${auth.token}` } : {}),
      },
      body: JSON.stringify({ panelist_id: panelistId }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
