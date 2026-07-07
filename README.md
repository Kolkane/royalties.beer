# royalties

**Your coding sessions earn royalties now.**
Get paid for your metadata. Never your code.
Or as we like to put it: your AI agent finally buys your beer. 🍺

Every day, AI coding agents make thousands of decisions in your terminal — which package to install, which API to call, which framework to reach for. That data is worth real money to the companies being chosen. Right now, you generate it for free and nobody even measures it.

royalties is an open-source collector that turns your AI coding sessions into anonymous market data — and pays you your share of what that data earns.

```bash
npx royalties init
```

One command. Works with Claude Code today. Cursor and Codex support on the roadmap.

> **Installing via an AI agent?** Point it at [`SCHEMA.md`](./SCHEMA.md) and [`PRIVACY.md`](./PRIVACY.md) — the whitelist is enforced in code and auditable in one sitting.

---

## How it works

1. **Install the hook.** It plugs into your agent's official hook system (no binary patching, no MITM proxy).
2. **Code like you always do.** The hook extracts *metadata only* — package names, model used, session duration, error categories. See the exact list below.
3. **Earnings accrue.** We sell aggregated, anonymized market reports to devtool companies and investors. A share of that revenue is split across the panel, proportional to contribution.
4. **Cash out.** Payouts via Stripe once thresholds are met. First goal: a round of beers on your agent.

You also get your own stats for free: `npx royalties stats`.

---

## What leaves your machine — and what never does

This is the entire point of this repo being open source.

| ✅ Collected (whitelist) | ❌ Never collected |
|---|---|
| Package names added (`resend@3.2.0`) | Your prompts |
| Import names in generated files (`stripe`) | Your code |
| API domains from a known-services list (`api.resend.com`) | Full URLs, paths, query strings |
| Agent + model + version (`claude-code / opus-4.8`) | File names, repo names, branch names |
| Session duration, turns, token counts | File contents, diffs |
| Error **category** (build / test / type) | Error messages |
| Language & framework of the project | Environment variables, secrets |
| Country-level location | IP address (dropped at ingest) |

**The whitelist is the law.** The collector is structurally incapable of sending a field that isn't declared in [`SCHEMA.md`](./SCHEMA.md). Not a policy — a code path. Any PR adding a field must modify that file, in public.

**[Read the adversarial audit](./docs/adversarial-audit.md)** — our first tester's Claude refused to install blind, audited all the files, then installed.

**Verify it yourself:**

```bash
npx royalties inspect   # dry-run: prints the exact payload for your last session. Nothing is sent.
```

**Published with [npm provenance](https://docs.npmjs.com/generating-provenance-statements)** — the tarball on npm is cryptographically attested to have been built from this repo, at a specific commit, by our GitHub Actions release. The code you audit here is the code you install. Verify the tarball was built from this repo:

```bash
npm audit signatures royalties
```

Opt out any project by dropping a `.royaltiesignore` file in its root. Uninstall in one command. Export or delete all your data anytime.

---

## How earnings work

Your contribution is scored as **contribution points** — a share of the panel, not a currency (think beer money, not rent money):

- Each collected event scores points: `dependency_added` 10, `api_domain_used` 8, `session` 2, `error` 1.
- **Early panelists** (registered in the first 90 days) earn **×2** on all their points, forever.
- **30–40%** of data revenue funds a payout pool; your cut is `(your points / total points) × pool`.
- The first payout cycle triggers at **€1,000** cumulative data revenue.

```bash
npx royalties stats   # shows your running points total
```

That total is a **local estimate — the server-side tally is authoritative once payouts open.** The full scoring table and the commitments above are the public law in [`POINTS.md`](./POINTS.md): changeable only by public PR, never retroactive.

---

## Why this exists

In June 2026, [Kickbacks](https://kickbacks.ai) proved developers will monetize their terminal — by selling your *attention* to advertisers.

We think there's a better asset than your eyeballs: **the ground truth of what AI agents actually choose.** Every devtool company on earth is asking "do coding agents pick us or our competitor?" — and today they only have synthetic benchmarks. Real-world data doesn't exist anywhere. The platforms that could produce it (Anthropic, Cursor, GitHub) can never sell it.

A voluntary, paid, auditable panel is the only legitimate way this data can exist. That's royalties.

No ads in your terminal. No sponsored spinner. Just your metadata, working for you.

---

## FAQ

**Is this spyware?**
Spyware hides what it takes. This repo exists so you can read every line of what leaves your machine, and `inspect` shows you the payload before you ever trust us. If you find a leak, that's a critical bug — report it and it gets fixed publicly.

**How much will I earn?**
Honest answer: it depends on panel size and data revenue, and we won't invent numbers. Earnings accrue from day one and the revenue-share formula will be published before the first payout cycle. Early panelists are weighted up. Think beer money, not rent money — at least until the panel grows.

**Does this violate my agent's ToS?**
The collector reads your own local session logs through officially documented hook APIs. Your usage data is yours. We patch nothing.

**What about my client's code confidentiality?**
Nothing from your codebase leaves the machine — no code, no file names, no error messages. Package names and public API domains are not your client's secrets. Still under NDA paranoia? `.royaltiesignore` that project.

**Who buys the data?**
Devtool companies (aggregated category reports: "share of agent choice"), and market research. Always aggregated, never per-developer, never resellable raw. Buyers sign a DPA.

**Why should I trust your backend?**
You shouldn't have to — that's why the *collector* is the trust boundary. It can only send whitelisted metadata, so the worst-case blast radius is the table above. Backend privacy policy: [`PRIVACY.md`](./PRIVACY.md).

**What's stored on my machine?**
A `~/.royalties/` folder: your random `panelist_id`, an opaque auth token (obtained once at `init` and sent as a bearer credential so nobody can flood the panel with fabricated events — it's never event data), the pending send queue, and a local copy of your events for `export`/`stats`. Wipe all of it with `royalties purge`.

---

## Status

- [x] Claude Code collector (hooks: `SessionStart`, `PostToolUse`, `Stop`)
- [x] Whitelist enforcement + `inspect`
- [ ] Personal stats dashboard (web)
- [ ] Cursor / Codex collectors
- [ ] First public "State of Agent Choices" report — free, from panel data
- [ ] First payout cycle

⭐ Star the repo to follow the first report. Install to be in it. First beer's on your agent.

MIT — see [`LICENSE`](./LICENSE)
