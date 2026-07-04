// session extraction from the Claude Code transcript (a JSONL file). We read
// only structural metadata — timestamps, token usage, model name, stop reason —
// never the substance of any message. The one exception is `userText`, a
// transient lowercased copy of user-turn text used solely to compute the
// dependency `initiated_by` boolean; it is never stored or sent.
import { existsSync, readFileSync } from 'node:fs';

export interface SessionMetrics {
  model?: string;
  duration_s: number;
  turns: number;
  tokens_in: number;
  tokens_out: number;
  ended_by: 'user' | 'agent' | 'error';
  agent_version?: string;
  userText: string;
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
  let firstTs = Infinity;
  let lastTs = -Infinity;
  let turns = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let model: string | undefined;
  let agentVersion: string | undefined;
  let lastStopReason: string | undefined;
  const userParts: string[] = [];

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const ts = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN;
    if (!Number.isNaN(ts)) {
      firstTs = Math.min(firstTs, ts);
      lastTs = Math.max(lastTs, ts);
    }
    if (typeof o.version === 'string') agentVersion = o.version;

    const message = asRecord(o.message);
    const sidechain = o.isSidechain === true;

    if (o.type === 'user' && o.toolUseResult === undefined && !sidechain && o.isMeta !== true) {
      turns++;
      userParts.push(userTextOf(message));
    }

    if (o.type === 'assistant' && !sidechain) {
      const usage = asRecord(message.usage);
      tokensIn +=
        num(usage.input_tokens) +
        num(usage.cache_read_input_tokens) +
        num(usage.cache_creation_input_tokens);
      tokensOut += num(usage.output_tokens);
      if (typeof message.model === 'string') model = message.model;
      if (typeof message.stop_reason === 'string') lastStopReason = message.stop_reason;
    }
  }

  const duration_s =
    firstTs <= lastTs ? Math.max(0, Math.round((lastTs - firstTs) / 1000)) : 0;

  return {
    model,
    duration_s,
    turns,
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    ended_by: lastStopReason === 'end_turn' || lastStopReason === undefined ? 'agent' : 'user',
    agent_version: agentVersion,
    userText: userParts.join('\n').toLowerCase(),
  };
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
