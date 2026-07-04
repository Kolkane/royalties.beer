// error extraction. The failure SIGNAL is a non-zero tool exit code (see
// hooks/handle.ts); the CATEGORY is derived from which command was run. The
// command text is used only to classify and to compute a correlation hash —
// neither the command nor any error message is ever stored or sent.
import { createHash } from 'node:crypto';
import type { ErrObs } from '../state.js';

export type Category = 'build' | 'test' | 'type' | 'runtime' | 'tool';

export function classifyCommand(command: string): Category {
  const c = command.toLowerCase();
  if (/\b(tsc|mypy|pyright|flow)\b/.test(c) || c.includes('typecheck') || c.includes('type-check')) {
    return 'type';
  }
  if (/\b(test|vitest|jest|pytest|mocha|phpunit|rspec)\b/.test(c) || /\b(go|cargo)\s+test\b/.test(c)) {
    return 'test';
  }
  if (/\b(build|compile|webpack|rollup|esbuild|make)\b/.test(c) || /\b(go|cargo)\s+build\b/.test(c)) {
    return 'build';
  }
  if (/\b(npm|pnpm|yarn|bun|pip|pip3|cargo|go|node|python|python3|deno)\b/.test(c)) {
    return 'runtime';
  }
  return 'tool';
}

/** Stable short hash of a command, used to correlate repeated attempts without
 *  ever storing the command text. */
export function commandSig(command: string): string {
  return createHash('sha256').update(command.trim()).digest('hex').slice(0, 16);
}

export interface ErrorEvent {
  category: string;
  retries: number;
  resolved: boolean;
}

/** Collapse per-command observations into one error event per distinct command
 *  that failed at least once. `retries` = number of failed attempts; `resolved`
 *  = the same command later succeeded. */
export function errorEvents(observations: ErrObs[]): ErrorEvent[] {
  const bySig = new Map<string, ErrObs[]>();
  for (const obs of observations) {
    const list = bySig.get(obs.sig) ?? [];
    list.push(obs);
    bySig.set(obs.sig, list);
  }

  const events: ErrorEvent[] = [];
  for (const list of bySig.values()) {
    const fails = list.filter((o) => !o.ok);
    if (fails.length === 0) continue;
    events.push({
      category: fails[0].category,
      retries: fails.length,
      resolved: list.some((o) => o.ok),
    });
  }
  return events;
}
