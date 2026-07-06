// Token accounting from the transcript. The one that matters for data quality:
// cache_read_input_tokens is the SAME cached context re-read every assistant
// turn, so it must not be summed into tokens_in (a 21-turn session otherwise
// reads as ~128M tokens). We count fresh input + tokens written to the cache.
import { expect, it } from 'vitest';
import { parseTranscript } from '../src/extract/session.js';

function transcript(lines: unknown[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

it('excludes cache_read_input_tokens from tokens_in', () => {
  const text = transcript([
    { type: 'assistant', timestamp: '2026-07-04T10:00:00.000Z', message: { model: 'claude-opus-4-8', stop_reason: 'tool_use', usage: { input_tokens: 5000, cache_creation_input_tokens: 2000, cache_read_input_tokens: 1_000_000, output_tokens: 300 } } },
    { type: 'assistant', timestamp: '2026-07-04T10:05:00.000Z', message: { model: 'claude-opus-4-8', stop_reason: 'end_turn', usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_050_000, output_tokens: 40 } } },
  ]);

  const m = parseTranscript(text);
  // input(5000+10) + cache_creation(2000+0) = 7010; the 2.05M cache_read is excluded.
  expect(m.tokens_in).toBe(7010);
  expect(m.tokens_out).toBe(340);
});

it('computes ACTIVE duration, excluding idle/resume gaps >= 20 min', () => {
  const text = transcript([
    { type: 'assistant', timestamp: '2026-07-04T10:00:00.000Z', message: { model: 'm', stop_reason: 'end_turn', usage: {} } },
    { type: 'assistant', timestamp: '2026-07-04T10:05:00.000Z', message: { model: 'm', stop_reason: 'end_turn', usage: {} } },
    // conversation resumed two days later:
    { type: 'assistant', timestamp: '2026-07-06T10:00:00.000Z', message: { model: 'm', stop_reason: 'end_turn', usage: {} } },
    { type: 'assistant', timestamp: '2026-07-06T10:03:00.000Z', message: { model: 'm', stop_reason: 'end_turn', usage: {} } },
  ]);
  // 5min (300s) + [2-day gap excluded] + 3min (180s) = 480s, not ~2 days.
  expect(parseTranscript(text).duration_s).toBe(480);
});
