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
    if (outcome === 'invalid-token') {
      clearToken(); // definitive unknown_token — drop it and re-register next flush
      break;
    }
    if (outcome !== 'ok') break; // rate-limited / transient 401 / 5xx / client error → keep queued & token
    sent += batch.length;
    pending = pending.slice(batch.length);
    writeLines(paths.queue, pending); // persist progress after every accepted batch
  }
  return { sent, remaining: pending.length, ok: pending.length === 0 };
}

type Outcome = 'ok' | 'invalid-token' | 'rate-limited' | 'error';

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
      // A 401 only drops the token when the server says so DEFINITIVELY — the
      // body is exactly {"error":"unknown_token"}. Every other 401 (a proxy, a
      // transient auth outage, an empty/garbled body) is treated as transient:
      // keep the token and retry later. Dropping a good token would force a
      // re-register that, on a 409, strands the identity as stuck auth.
      if (res.status === 401) return (await isUnknownToken(res)) ? 'invalid-token' : 'error';
      if (res.status === 429) return 'rate-limited';
      if (res.status < 500) return 'error'; // client error: leave queued, don't hammer
    } catch {
      // offline / timeout: fall through to backoff and retry
    }
    await sleep(Math.min(2000, 200 * 2 ** attempt));
  }
  return 'error';
}

/** True only for the ingest server's definitive token-rejection body,
 *  {"error":"unknown_token"}. An unparseable or differently-shaped body returns
 *  false, so a proxy error or a partial response never costs us a valid token. */
async function isUnknownToken(res: Response): Promise<boolean> {
  try {
    const parsed = JSON.parse(await res.text()) as { error?: unknown };
    return parsed?.error === 'unknown_token';
  } catch {
    return false;
  }
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
