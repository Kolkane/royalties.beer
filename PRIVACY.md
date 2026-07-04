# Privacy

Plain language. The legal version will live at royalties.sh/privacy — this file explains what actually happens.

## What we hold

**Event stream** — the whitelisted metadata in [`SCHEMA.md`](./SCHEMA.md), keyed by a random `panelist_id`.

**Account** — your email and payout details (Stripe), stored separately from the event stream. The join between account and `panelist_id` exists only in the payout system, so analysts and buyers never see it.

## What we do with it

- Aggregate it into market reports (minimum bucket size: 50 panelists — no report cell can describe fewer people than that)
- Compute your revenue share
- Show you your own stats

## What we never do

- Sell or share raw, per-developer data
- Let buyers re-identify panelists (contractually via DPA + technically via aggregation thresholds)
- Train models on your data
- Use the data for advertising

## Your rights (GDPR — we're EU-based, this applies to everyone)

- **Export**: `royalties export` — all your events, JSON
- **Delete**: `royalties purge` — local queue wiped + server-side erasure within 30 days
- **Pause**: `royalties pause`, per-project `.royaltiesignore`
- Controller details, legal basis (consent, Art. 6(1)(a)) and DPO contact: royalties.sh/privacy

## Retention

Raw events: 24 months, then reduced to aggregates. Account data: while your account exists.

## If we screw up

A collector bug that leaks a non-whitelisted field is a critical severity issue: public disclosure in the repo, affected data deleted at ingest, post-mortem published. Report: security@royalties.sh
