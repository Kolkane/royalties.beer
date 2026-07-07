/**
 * points.ts — the contribution-points scoring table.
 *
 * THIS MIRRORS POINTS.md, the public "law" for how local contribution points are
 * scored. Any change here MUST change POINTS.md in the same PR (CI drift-guard),
 * and — like the scoring itself — is NEVER retroactive.
 *
 * These are LOCAL ESTIMATES. Points are contribution shares, not currency; the
 * server-side tally is authoritative once payouts open. `royalties stats` labels
 * the number accordingly.
 */
import { EVENT_TYPES, type EventType } from './schema.js';

/** Points per collected event, by type. Keyed by EventType, so adding a new
 *  event to the whitelist is a compile error until it is scored here (and in
 *  POINTS.md). Mirrors the POINTS.md scoring table exactly. */
export const POINTS_TABLE: Record<EventType, number> = {
  dependency_added: 10,
  api_domain_used: 8,
  session: 2,
  error: 1,
};

/** Early panelists (registered within EARLY_WINDOW_DAYS of the program launch)
 *  earn this multiplier on all their points, forever. Mirrors POINTS.md. */
export const EARLY_PANELIST_MULTIPLIER = 2;

/** Public-launch anchor for the early-panelist window. A registration qualifies
 *  if it is AT OR BEFORE PROGRAM_LAUNCH + EARLY_WINDOW_DAYS — there is NO lower
 *  bound, so panelists who registered before launch (our early testers) also
 *  count as early. Mirrors POINTS.md; changeable only by public, forward-only PR. */
export const PROGRAM_LAUNCH_ISO = '2026-07-09T00:00:00.000Z';
export const EARLY_WINDOW_DAYS = 90;

export interface PointsBreakdown {
  base: number; // points before the multiplier
  multiplier: number; // EARLY_PANELIST_MULTIPLIER for early panelists, else 1
  total: number; // base * multiplier
  early: boolean;
  counted: number; // number of scored events
  byType: Record<string, number>; // base points per event type
}

/** Whether a registration qualifies for the early-panelist multiplier: any time
 *  AT OR BEFORE launch + EARLY_WINDOW_DAYS. No lower bound — pre-launch testers
 *  qualify. A missing/unparseable timestamp is treated as NOT early. */
export function isEarlyPanelist(registeredAtIso: string | null | undefined): boolean {
  if (!registeredAtIso) return false;
  const reg = Date.parse(registeredAtIso);
  if (!Number.isFinite(reg)) return false;
  const cutoff = Date.parse(PROGRAM_LAUNCH_ISO) + EARLY_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return reg <= cutoff;
}

/** The local contribution-points estimate for a stream of event `type`s.
 *  Unknown types score 0 (forward-compatible with older/newer logs). */
export function computePoints(types: Iterable<string>, opts: { early?: boolean } = {}): PointsBreakdown {
  const table = POINTS_TABLE as Record<string, number>;
  const byType: Record<string, number> = {};
  let base = 0;
  let counted = 0;
  for (const type of types) {
    const pts = table[type];
    if (typeof pts !== 'number') continue; // unknown/unscored type -> 0
    byType[type] = (byType[type] ?? 0) + pts;
    base += pts;
    counted++;
  }
  const multiplier = opts.early ? EARLY_PANELIST_MULTIPLIER : 1;
  return { base, multiplier, total: base * multiplier, early: !!opts.early, counted, byType };
}

/** Exhaustiveness guard: every whitelisted event type must have a score. This is
 *  a runtime echo of the compile-time Record<EventType, number> check above, so a
 *  new event type can never silently score nothing. */
export function unscoredEventTypes(): string[] {
  return EVENT_TYPES.filter((t) => typeof (POINTS_TABLE as Record<string, number>)[t] !== 'number');
}
