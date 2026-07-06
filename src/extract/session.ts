// session extraction from the Claude Code transcript (a JSONL file). We read
// only structural metadata — timestamps, token usage, model name, stop reason —
// never the substance of any message. The one exception is `userText`, a
// transient lowercased copy of user-turn text used solely to compute the
// dependency `initiated_by` boolean; it is never stored or sent.
import { existsSync, readFileSync } from 'node:fs';
import { STALE_MS } from '../config.js';
import { classifyCommand, commandSig } from './error.js';
import type { ErrObs } from '../state.js';

export interface SessionMetrics {
  model?: string;
  duration_s: number;
  turns: number;
  tokens_in: number;
  tokens_out: number;
  ended_by: 'user' | 'agent' | 'error';
  agent_version?: string;
  userText: string;
  /** Bash tool results paired from the transcript, one per run (ok unless the
   *  result was flagged is_error). Collapsed into error events at finalize. */
  errors: ErrObs[];
}

export function readTranscript(path: string): SessionMetrics | null {
  if (!path || !existsSync(path)) return null;
  try {
    return parseTranscript(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function parseTranscript(text: string): SessionMetrics {
  const timestamps: number[] = [];
  let turns = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let model: string | undefined;
  let agentVersion: string | undefined;
  let lastStopReason: string | undefined;
  const userParts: string[] = [];
  const toolUses = new Map<string, { name: string; command: string }>();
  const errors: ErrObs[] = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    if (!Number.isNaN(ts)) timestamps.push(ts);
    if (typeof o.version === 'string') agentVersion = o.version;

    const message = asRecord(o.message);
    const sidechain = o.isSidechain === true;

    if (o.type === 'user' && o.toolUseResult === undefined && !sidechain && o.isMeta !== true) {
      turns++;
      userParts.push(userTextOf(message));
    }

    if (o.type === 'assistant' && !sidechain) {
      const usage = asRecord(message.usage);
      // Count each input token once: fresh input + tokens written to the prompt
      // cache. EXCLUDE cache_read_input_tokens — that is the *same* cached
      // context re-read on every assistant turn, so summing it across a session
      // over-counts by orders of magnitude (a 21-turn session read as ~128M).
      tokensIn += num(usage.input_tokens) + num(usage.cache_creation_input_tokens);
      tokensOut += num(usage.output_tokens);
      if (typeof message.model === 'string') model = message.model;
      if (typeof message.stop_reason === 'string') lastStopReason = message.stop_reason;
    }

    if (!sidechain && Array.isArray(message.content)) collectToolIo(message.content, toolUses, errors);
  }

  return {
    model,
    duration_s: activeDuration(timestamps),
    turns,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    ended_by: lastStopReason === 'end_turn' || lastStopReason === undefined ? 'agent' : 'user',
    agent_version: agentVersion,
    userText: userParts.join('\n').toLowerCase(),
    errors,
  };
}

/** Pair Bash tool_use blocks with their tool_result, recording one observation
 *  per Bash run (ok unless the result is flagged is_error). The assistant
 *  tool_use always precedes its user tool_result in the transcript, so a single
 *  forward pass with a shared id->command map suffices. Non-Bash tools and
 *  sidechain (sub-agent) turns are ignored. */
function collectToolIo(
  content: unknown[],
  toolUses: Map<string, { name: string; command: string }>,
  errors: ErrObs[],
): void {
  for (const block of content) {
    const b = asRecord(block);
    if (b.type === 'tool_use' && typeof b.id === 'string') {
      const input = asRecord(b.input);
      toolUses.set(b.id, {
        name: typeof b.name === 'string' ? b.name : '',
        command: typeof input.command === 'string' ? input.command : '',
      });
    } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
      const use = toolUses.get(b.tool_use_id);
      if (use && use.name === 'Bash' && use.command) {
        errors.push({ category: classifyCommand(use.command), sig: commandSig(use.command), ok: b.is_error !== true });
      }
    }
  }
}

/** Time actually spent working: the sum of gaps between consecutive events,
 *  ignoring any gap >= STALE_MS. A resumed conversation spanning days would
 *  otherwise report last_ts - first_ts (e.g. 36h) as the session duration. */
function activeDuration(timestamps: number[]): number {
  const sorted = [...timestamps].sort((a, b) => a - b);
  let activeMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > 0 && gap < STALE_MS) activeMs += gap;
  }
  return Math.round(activeMs / 1000);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function userTextOf(message: Record<string, unknown>): string {
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(blockText).join(' ');
  return '';
}

function blockText(block: unknown): string {
  const rec = asRecord(block);
  return rec.type === 'text' && typeof rec.text === 'string' ? rec.text : '';
}
