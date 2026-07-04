# Data Schema — v0.1.0

**This file is the single source of truth for what royalties can transmit.**

The collector serializes events against this schema with `additionalProperties: false`. A field not listed here cannot leave your machine — the send path rejects it. Changing this file requires a public PR and a version bump, and the CLI prints the schema version + hash on every `init` and `inspect`.

## Envelope (every event)

| Field | Type | Example | Notes |
|---|---|---|---|
| `schema_version` | string | `"0.1.0"` | |
| `type` | enum | `"session"` | Which event this is: `session` \| `dependency_added` \| `api_domain_used` \| `error` |
| `panelist_id` | string | `"p_8f3a…"` | Random UUID generated at init. No link to name/email in event stream |
| `country` | string | `"FR"` | ISO code, **added at ingest** from the request IP (which is then discarded). The collector never sends it |
| `ts` | int | `1751536800` | Unix seconds, truncated to the hour |
| `agent` | enum | `"claude-code"` | `claude-code` \| `cursor` \| `codex` |
| `agent_version` | string | `"2.1.150"` | |

A `?` after a field's type (below) marks it **optional**: the collector omits it from the event entirely when it is not known — never sent empty or guessed.

## Event: `session`

| Field | Type | Example |
|---|---|---|
| `model` | string | `"claude-opus-4-8"` |
| `duration_s` | int | `1840` |
| `turns` | int | `23` |
| `tokens_in` / `tokens_out` | int | `184000` / `52000` |
| `language` | enum? | `"typescript"` (from a fixed list of 30) — optional |
| `framework` | enum? | `"nextjs"` (from a fixed list of 80) — optional |
| `ended_by` | enum | `"user"` \| `"agent"` \| `"error"` |

## Event: `dependency_added`

Emitted when the agent runs a package-manager install command or edits a manifest (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`).

| Field | Type | Example |
|---|---|---|
| `ecosystem` | enum | `"npm"` \| `"pypi"` \| `"cargo"` \| `"go"` |
| `package` | string | `"resend"` — name only, validated against registry naming rules |
| `version` | string? | `"3.2.0"` — optional, present only when a concrete version is known |
| `initiated_by` | enum | `"agent"` \| `"user_prompt"` (heuristic: was the package named in the user's turn? boolean only — the prompt itself is never read into the event) |

## Event: `api_domain_used`

Emitted when generated code contains a domain from `known-services.json` (public, versioned list of ~500 devtool API domains).

| Field | Type | Example |
|---|---|---|
| `domain` | enum | `"api.resend.com"` — must match the known-services list; anything else is dropped |

## Event: `error`

| Field | Type | Example |
|---|---|---|
| `category` | enum | `"build"` \| `"test"` \| `"type"` \| `"runtime"` \| `"tool"` |
| `retries` | int | `2` |
| `resolved` | bool | `true` |

## Explicitly forbidden — enforced by tests

The test suite asserts that payloads containing any of the following are rejected before network I/O:

prompts · code content · diffs · file names · directory paths · repo/branch names · error messages · full URLs · query strings · env vars · email · hostname · username · IP (client-side)

## Local controls

- `.royaltiesignore` in a project root — zero events from that project
- `royalties pause` / `resume`
- `royalties inspect` — prints pending payload, sends nothing
- `royalties purge` — deletes local queue + requests server-side deletion
