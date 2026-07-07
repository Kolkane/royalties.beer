// Contribution points: scoring per event type, the early-panelist multiplier,
// and a drift-guard asserting src/points.ts and POINTS.md agree — the scoring
// table is public law, so code and spec must never diverge.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EARLY_PANELIST_MULTIPLIER,
  EARLY_WINDOW_DAYS,
  POINTS_TABLE,
  PROGRAM_LAUNCH_ISO,
  computePoints,
  isEarlyPanelist,
  unscoredEventTypes,
} from '../src/points.js';

const POINTS_MD = readFileSync(fileURLToPath(new URL('../POINTS.md', import.meta.url)), 'utf8');

describe('scoring', () => {
  it('scores each event type per the table', () => {
    expect(POINTS_TABLE).toEqual({ dependency_added: 10, api_domain_used: 8, session: 2, error: 1 });
    expect(computePoints(['dependency_added']).total).toBe(10);
    expect(computePoints(['api_domain_used']).total).toBe(8);
    expect(computePoints(['session']).total).toBe(2);
    expect(computePoints(['error']).total).toBe(1);
  });

  it('sums a mixed stream and breaks it down by type', () => {
    const p = computePoints(['session', 'dependency_added', 'dependency_added', 'api_domain_used', 'error']);
    expect(p.base).toBe(2 + 10 + 10 + 8 + 1); // 31
    expect(p.total).toBe(31); // no multiplier
    expect(p.counted).toBe(5);
    expect(p.byType).toEqual({ session: 2, dependency_added: 20, api_domain_used: 8, error: 1 });
  });

  it('ignores unknown/unscored types (scores 0, forward-compatible)', () => {
    const p = computePoints(['session', 'mystery_future_event', 'dependency_added']);
    expect(p.counted).toBe(2);
    expect(p.total).toBe(12);
  });

  it('every whitelisted event type has a score (no silent 0)', () => {
    expect(unscoredEventTypes()).toEqual([]);
  });
});

describe('early-panelist multiplier', () => {
  it('applies the multiplier to all points when early', () => {
    const p = computePoints(['dependency_added', 'session'], { early: true });
    expect(p.multiplier).toBe(EARLY_PANELIST_MULTIPLIER);
    expect(p.base).toBe(12);
    expect(p.total).toBe(12 * EARLY_PANELIST_MULTIPLIER);
    expect(p.early).toBe(true);
  });

  it('applies no multiplier when not early', () => {
    expect(computePoints(['dependency_added'], { early: false }).total).toBe(10);
    expect(computePoints(['dependency_added']).multiplier).toBe(1);
  });

  const launch = Date.parse(PROGRAM_LAUNCH_ISO);
  const day = 24 * 60 * 60 * 1000;
  it('isEarlyPanelist: qualifies through launch + window (cutoff inclusive), not after', () => {
    expect(isEarlyPanelist(new Date(launch).toISOString())).toBe(true); // at launch
    expect(isEarlyPanelist(new Date(launch + (EARLY_WINDOW_DAYS - 1) * day).toISOString())).toBe(true);
    expect(isEarlyPanelist(new Date(launch + EARLY_WINDOW_DAYS * day).toISOString())).toBe(true); // cutoff
    expect(isEarlyPanelist(new Date(launch + (EARLY_WINDOW_DAYS + 1) * day).toISOString())).toBe(false);
  });

  it('isEarlyPanelist: no lower bound — registrations before launch (testers) qualify', () => {
    expect(isEarlyPanelist(new Date(launch - day).toISOString())).toBe(true); // the day before launch
    expect(isEarlyPanelist(new Date(launch - 120 * day).toISOString())).toBe(true); // well before launch
  });

  it('isEarlyPanelist: missing/garbage timestamp is not early', () => {
    expect(isEarlyPanelist(null)).toBe(false);
    expect(isEarlyPanelist(undefined)).toBe(false);
    expect(isEarlyPanelist('not-a-date')).toBe(false);
  });
});

describe('drift-guard: POINTS.md mirrors src/points.ts', () => {
  it('the scoring table in POINTS.md matches POINTS_TABLE exactly', () => {
    const rows = [...POINTS_MD.matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*(\d+)\s*\|/gm)];
    const fromDoc: Record<string, number> = {};
    for (const [, type, pts] of rows) fromDoc[type] = Number(pts);
    expect(fromDoc).toEqual(POINTS_TABLE);
  });

  it('POINTS.md states the committed numbers (multiplier, window, revenue band, first-cycle trigger)', () => {
    expect(POINTS_MD).toContain(`×${EARLY_PANELIST_MULTIPLIER}`);
    expect(POINTS_MD).toContain(`${EARLY_WINDOW_DAYS} days`);
    expect(POINTS_MD).toContain('30–40%');
    expect(POINTS_MD).toContain('€1,000');
  });

  it('POINTS.md documents the same program-launch date as the code', () => {
    expect(POINTS_MD).toContain(PROGRAM_LAUNCH_ISO.slice(0, 10)); // 2026-07-04
  });
});
