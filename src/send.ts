// The one and only network path. Sends batches of already-validated events to
// the ingest endpoint with exponential backoff. Offline-safe: on any failure the
// events stay in the queue for a later attempt, and nothing here ever throws.
import { EVENTS_ENDPOINT, PURGE_ENDPOINT, SEND_BATCH, paths } from './config.js';
import { readLines, writeLines } from './queue.js';

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

  let sent = 0;
  while (pending.length > 0 && Date.now() < deadline) {
    const batch = pending.slice(0, SEND_BATCH);
    if (!(await postBatch(batch, deadline))) break;
    sent += batch.length;
    pending = pending.slice(batch.length);
    writeLines(paths.queue, pending); // persist progress after every accepted batch
  }
  return { sent, remaining: pending.length, ok: pending.length === 0 };
}

async function postBatch(lines: string[], deadline: number): Promise<boolean> {
  const body = `{"events":[${lines.join(',')}]}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (Date.now() >= deadline) return false;
    try {
      const res = await fetch(EVENTS_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(Math.max(500, Math.min(4000, deadline - Date.now()))),
      });
      if (res.ok) return true;
      if (res.status < 500) return false; // client error: leave queued, don't hammer
    } catch {
      // offline / timeout: fall through to backoff and retry
    }
    await sleep(Math.min(2000, 200 * 2 ** attempt));
  }
  return false;
}

/** Ask the server to erase this panelist's data (best-effort). */
export async function requestServerPurge(panelistId: string): Promise<boolean> {
  try {
    const res = await fetch(PURGE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
