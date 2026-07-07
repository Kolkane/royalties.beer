# Contribution Points — v1

**This file is the single source of truth for how contribution points are scored.**

Points are **contribution shares, not currency** — they measure how much your sessions contributed to the panel, and they convert to a share of the data-revenue pool at payout time. Think **beer money, not rent money**.

> **Local estimate today.** `royalties stats` computes your points from your local event history using the table below. The **server-side tally is authoritative once payouts open** — the local number is an estimate, not a balance.

The scoring table is mirrored in code ([`src/points.ts`](./src/points.ts)). Changing either requires changing **both, in the same public PR** (CI enforces it). Scoring changes are **never retroactive**: past events keep the points they earned under the table in force when they were collected.

## Scoring table

Points are awarded per **collected** event. Only whitelisted events ever leave your machine — see [`SCHEMA.md`](./SCHEMA.md) — and only collected events score.

| Event | Points | Why |
|---|---|---|
| `dependency_added` | 10 | The highest-signal choice: which package an agent actually picked |
| `api_domain_used` | 8 | Which service an agent reached for |
| `session` | 2 | A coding session, with model / duration / token metadata |
| `error` | 1 | An error **category** (build / test / type / runtime / tool) |

## Early-panelist multiplier

Panelists who **register within the first 90 days of the program** earn a **×2 multiplier on all their points, forever** — early data is scarcer and does the most to bootstrap the panel, so early contributors carry more weight.

The window is anchored to the program launch date (`PROGRAM_LAUNCH` in `src/points.ts`, currently **2026-07-04**); registrations at or before launch + 90 days qualify. `royalties stats` estimates this from your local registration time; the server-side determination is authoritative.

## How points become money

- **The pool.** **30–40%** of net data revenue funds the payout pool each cycle.
- **Your payout.** `payout = (your points / total points) × pool` — your share of the pool is your points over everyone's points.
- **First cycle.** The first payout cycle triggers at **€1,000 cumulative data revenue**. Below that, points accrue but no cycle runs.
- **Payment.** Via Stripe, once thresholds are met.

## Commitments

- Scoring changes only via **public PR**, and are **never retroactive**.
- The revenue-share band (30–40%) and the €1,000 first-cycle trigger are published here, before the first cycle; any change is public and forward-only.
- Points are **contribution shares, not a currency or a security** — they confer a share of a discretionary revenue pool, not a debt or an equity claim.
- The authoritative tally is server-side. The local estimate exists so you can watch your contribution accrue from day one.
