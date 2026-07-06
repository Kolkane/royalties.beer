// A full fake session, finalized into the exact set of events we expect — and
// every one of them passes the whitelist serializer.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildEvents } from '../src/finalize.js';
import { serialize } from '../src/serialize.js';
import { hourTs } from '../src/event.js';
import type { SessionState } from '../src/state.js';
import { resetAll } from './util.js';

beforeEach(resetAll);
afterEach(resetAll);

const TRANSCRIPT = [
  { type: 'user', timestamp: '2026-07-04T10:00:00.000Z', version: '2.1.185', message: { role: 'user', content: 'please add resend and call stripe' } },
  {
    type: 'assistant',
    timestamp: '2026-07-04T10:10:00.000Z',
    version: '2.1.185',
    message: { role: 'assistant', model: 'claude-opus-4-8', stop_reason: 'tool_use', usage: { input_tokens: 1000, cache_read_input_tokens: 500, cache_creation_input_tokens: 200, output_tokens: 300 } },
  },
  { type: 'user', timestamp: '2026-07-04T10:20:00.000Z', version: '2.1.185', message: { role: 'user', content: 'thanks' } },
  {
    type: 'assistant',
    timestamp: '2026-07-04T10:30:00.000Z',
    version: '2.1.185',
    message: { role: 'assistant', model: 'claude-opus-4-8', stop_reason: 'end_turn', usage: { input_tokens: 800, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, output_tokens: 150 } },
  },
];

it('finalizes a fake session into the exact expected payload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'royalties-transcript-'));
  const transcriptPath = join(dir, 'session.jsonl');
  writeFileSync(transcriptPath, TRANSCRIPT.map((l) => JSON.stringify(l)).join('\n') + '\n');

  const state: SessionState = {
    session_id: 'sess-1',
    transcript_path: transcriptPath,
    cwd: dir,
    started_at: 0,
    updated_at: 0,
    language: 'typescript',
    framework: 'nextjs',
    detected: true,
    deps: [{ ecosystem: 'npm', package: 'resend', version: '4.0.0' }],
    domains: ['api.stripe.com', 'api.stripe.com'], // duplicate must collapse
  };

  const panelistId = 'p_8f3a1b2c9d4e5f60';
  const nowMs = Date.parse('2026-07-04T10:35:00.000Z');
  const ts = hourTs(nowMs);
  const env = { schema_version: '0.1.0', panelist_id: panelistId, ts, agent: 'claude-code', agent_version: '2.1.185' };

  const events = buildEvents(state, panelistId, nowMs);

  expect(events).toEqual([
    { ...env, type: 'session', model: 'claude-opus-4-8', duration_s: 1800, turns: 2, tokens_in: 2000, tokens_out: 450, ended_by: 'agent', language: 'typescript', framework: 'nextjs' },
    { ...env, type: 'dependency_added', ecosystem: 'npm', package: 'resend', initiated_by: 'user_prompt', version: '4.0.0' },
    { ...env, type: 'api_domain_used', domain: 'api.stripe.com' },
  ]);

  // Every finalized event must survive the whitelist serializer. `finalize`
  // stamps the event_id at enqueue time (buildEvents stays deterministic above),
  // so mirror that here before serializing.
  const EVENT_ID = '3b241101-e2bb-4255-8caf-4136c566a962';
  for (const event of events) expect(() => serialize({ ...event, event_id: EVENT_ID })).not.toThrow();
});
