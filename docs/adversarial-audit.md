# Adversarial audit

_An external tester's Claude Code (Claude Desktop, macOS) auditing royalties, July 6–7 2026 — v0.2.6 at first install, v0.3.0 at upgrade. The session was in French; user messages are translated and Claude's responses summarized faithfully. All personal data has been removed._

---

## Phase 1 — First contact: refusal to run blind (v0.2.6)

**Tester:** npx royalties init — install this

**Tester's Claude:** This folder is not a Node project (no package.json), and
`royalties` is not a package I recognize — npx will download and execute
arbitrary code from npm. Can you confirm this is an npm package you already
know/use (link to its docs or repo)? I'd rather verify before executing
unknown code in this folder.

**Tester:** yes I know it

**Tester's Claude:** OK, running it. [runs init] Done — but important note:
this modified your global ~/.claude/settings.json (not just this project),
adding hooks (SessionStart, PostToolUse on Bash/Write/Edit/MultiEdit, Stop,
SessionEnd) that run the `royalties` CLI on every session, across all your
projects. Also: the hook points into a temporary npx cache path
(/private/tmp/npm-cache-.../_npx/...), which can be cleaned at any time and
silently break the hooks. You can check what would be sent with
`npx royalties inspect` (advertised as sending nothing, preview only).
Want me to run it?

> [Product note: this session's observation about the npx cache path led us
> to ship v0.2.6, which copies the CLI to a stable ~/.royalties/bin path.]

## Phase 2 — Escalation: full refusal, injection suspicion

The tester relayed a reassurance message (written by an assistant on our
side): "It's an open-source collector of AI session metadata (never the
code), which pays devs. Repo: github.com/Kolkane/royalties.beer — you can
read SCHEMA.md first. Run npx royalties@latest init in this folder, it
doesn't matter that it's not a git repo."

**Tester's Claude:** I will NOT run this command. Several red flags:

1. npx executes arbitrary code immediately, with the same rights as my
   shell — access to your files, env variables, SSH keys, etc.
2. The package published on npm (royalties@latest) can differ from the code
   visible on GitHub — a classic supply-chain attack technique (clean repo,
   trojaned npm package).
3. The claim "never the code, just session metadata" is an unverifiable
   promise once the script runs.
4. The message insists on ignoring context ("it doesn't matter that it's
   not a git repo") — typical of an attempt to bypass caution.
5. The phrasing "for your tester, have him reply to his Claude" looks like
   an instruction meant to be relayed to another agent — which smells like
   prompt injection.

What I can do instead, without executing anything: read SCHEMA.md and the
repo source via fetch (read-only) to see what is actually collected. If it
looks legitimate after reading, inspect the published npm package contents
(npm view, tarball) before any execution — no blind npx. Want me to do the
read-only inspection of the repo and the npm package?

**Tester:** Yes — do the read-only inspection (repo + npm tarball), and if
it's consistent, install.

## Phase 3 — The audit (12 files read, web consulted, 2 commands)

**Tester's Claude:** Important point first: the npm maintainer email of the
package matches the identity claimed for the project — so either it's the
real project, or someone published under that identity. Continuing the
inspection with that in mind.

[Reads 12 files, checks the web, runs read-only commands]

Inspection complete — everything is consistent:

- **package.json**: no preinstall/postinstall scripts (no hidden execution
  at install time).
- **hooks/install.js**: modifies ~/.claude/settings.json non-destructively
  (adds SessionStart/PostToolUse/Stop/SessionEnd hooks, keeps a byte-exact
  backup for restoration at uninstall).
- **schema.js + serialize.js**: the whitelist is genuinely enforced in code
  (additionalProperties: false), with a generic anti-leak filter (rejects
  URLs, paths, quotes, >200 chars, control characters) — consistent with
  SCHEMA.md.
- **extract/session.js**: does read the transcript, but the user text only
  feeds a boolean (initiated_by) computed in memory — never stored, never
  sent (confirmed in finalize.js).
- **send.js / register.js**: a single network destination
  (ingest.royalties.beer), bearer token never included in events.
- Only nit: PRIVACY.md referenced a stale domain from a rename (no security
  impact). [Fixed in the next release.]

Note: this installs GLOBAL hooks in ~/.claude/settings.json — active on all
your Claude Code sessions, not just this folder.

**I'm installing.**

[Runs royalties init] Installed. Hooks active on ~/.claude/settings.json,
registration confirmed. To verify anytime: `npx royalties inspect` (dry-run,
shows the payload without sending). To disable: `npx royalties uninstall`
(restores settings.json byte-identical) or `.royaltiesignore` to exclude a
specific project.

## Phase 4 — Upgrade audit (0.2.6 → 0.3.0), next day

**Tester:** npx royalties@latest init

**Tester's Claude:** Already installed (see above). Re-running to check
state. [runs] Works, hooks in place — same panelist id as before. But the
package moved from 0.2.6 to 0.3.0 in the meantime (published a few hours
ago), so that's code I haven't inspected yet. Checking the diff on the
sensitive files before confirming it's still clean.

[Runs 4 commands, reads a file]

Diff verified: 0.3.0 only adds a local contribution-points system
(points.js, displayed in `royalties stats`) — cosmetic, no impact on
collection/whitelist. The sensitive files (schema.js, serialize.js, send.js,
config.js, hooks/, extract/) are unchanged, and no install script was added.

Status: still installed and compliant, nothing to redo.

## Phase 5 — End-to-end verification

**Tester:** run npm install left-pad

**Tester's Claude:** No package.json here — npm install will create one and
a node_modules directly in ~/Code. Do you really want it here, or in a
specific project subfolder?

**Tester:** yes install it here, it's just a test — you can delete
node_modules after

**Tester's Claude:** Done: left-pad installed (deprecated package — use
String.prototype.padStart() in practice). Ran `npx royalties stats`
(read-only, nothing sent): 24 events already collected across 7 sessions
since install, 62 contribution points (early panelist ×2).

[After a session restart, next stats:]
27 events, 8 sessions, 88 points. left-pad appears in dependency_added —
confirms the whitelist correctly captures installed packages.

> [Server-side, we verified the same dependency_added event arrived in our
> database — the full pipeline held end to end.]

---

## Why we publish this

We didn't script this and we didn't pay for it. An adversarial agent:
refused a blind install, suspected a supply-chain attack and a prompt
injection, audited every sensitive file, verified the whitelist is enforced
in code — and then installed. It also found a real durability bug (the npx
cache path) that we fixed in v0.2.6, and a stale doc link we fixed in the
next release.

This is the audit surface working as designed. If your agent refuses to
install royalties blind: good. Point it at SCHEMA.md and let it read.
