// Turns a finished session's accumulated state into events. `buildEvents` is a
// pure function (state + transcript -> event objects) so it is fully snapshot
// testable; `finalize` serializes each event through the whitelist and enqueues
// it. Anything the serializer rejects is dropped, never sent.
import { randomUUID } from 'node:crypto';
import { STALE_MS } from './config.js';
import { makeEnvelope, hourTs } from './event.js';
import { serialize, Rejected } from './serialize.js';
import { enqueue } from './queue.js';
import { readTranscript } from './extract/session.js';
import { errorEvents } from './extract/error.js';
import { deleteState, listStates, type SessionState, type DepObs } from './state.js';

type EventObj = Record<string, string | number | boolean>;

export function buildEvents(
  state: SessionState,
  panelistId: string,
  nowMs: number,
  opts: { preview?: boolean } = {},
): EventObj[] {
  const metrics = readTranscript(state.transcript_path);
  const agentVersion = state.agent_version ?? metrics?.agent_version ?? 'unknown';
  const ts = hourTs(nowMs);
  const base = (): EventObj => ({ ...makeEnvelope(panelistId, agentVersion, ts) });
  const events: EventObj[] = [];

  if (metrics && metrics.model) {
    const session: EventObj = {
      ...base(),
      type: 'session',
      model: metrics.model,
      duration_s: metrics.duration_s,
      turns: metrics.turns,
      tokens_in: metrics.tokens_in,
      tokens_out: metrics.tokens_out,
    };
    // A preview (`royalties inspect`) is of an IN-PROGRESS session — it hasn't
    // ended, so we don't assert an ended_by for it.
    if (!opts.preview) session.ended_by = metrics.ended_by;
    if (state.language) session.language = state.language;
    if (state.framework) session.framework = state.framework;
    events.push(session);
  }

  for (const dep of dedupeDeps(state.deps)) {
    const named = metrics ? metrics.userText.includes(dep.package.toLowerCase()) : false;
    const event: EventObj = {
      ...base(),
      type: 'dependency_added',
      ecosystem: dep.ecosystem,
      package: dep.package,
      initiated_by: named ? 'user_prompt' : 'agent',
    };
    if (dep.version) event.version = dep.version;
    events.push(event);
  }

  for (const domain of [...new Set(state.domains)]) {
    events.push({ ...base(), type: 'api_domain_used', domain });
  }

  for (const err of errorEvents(metrics ? metrics.errors : [])) {
    events.push({
      ...base(),
      type: 'error',
      category: err.category,
      retries: err.retries,
      resolved: err.resolved,
    });
  }

  return events;
}

/** Build, serialize and enqueue a session's events. Returns how many were sent
 *  to the queue. Ignored sessions and rejected events contribute nothing. */
export function finalize(state: SessionState, panelistId: string, nowMs: number = Date.now()): number {
  let count = 0;
  for (const event of buildEvents(state, panelistId, nowMs)) {
    try {
      // Stamp the idempotency key HERE, as the event is queued — not in
      // buildEvents (which stays deterministic/snapshot-pure). It rides inside
      // the serialized queue line, so a retry re-sends the SAME event_id and the
      // ingest server upserts on it: a duplicate delivery never duplicates a row.
      enqueue(serialize({ ...event, event_id: randomUUID() }));
      count++;
    } catch (err) {
      if (!(err instanceof Rejected)) throw err; // only whitelist rejections are silently dropped
    }
  }
  return count;
}

/** Finalize every session that has been idle longer than STALE_MS. */
export function finalizeStale(panelistId: string, nowMs: number = Date.now()): number {
  let total = 0;
  for (const state of listStates()) {
    if (nowMs - state.updated_at < STALE_MS) continue;
    total += finalize(state, panelistId, nowMs);
    deleteState(state.session_id);
  }
  return total;
}

function dedupeDeps(deps: DepObs[]): DepObs[] {
  const byName = new Map<string, DepObs>();
  for (const dep of deps) {
    const key = `${dep.ecosystem} ${dep.package}`;
    const existing = byName.get(key);
    if (!existing) byName.set(key, { ...dep });
    else if (dep.version && !existing.version) existing.version = dep.version;
  }
  return [...byName.values()];
}
