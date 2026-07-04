/**
 * schema.ts — THE WHITELIST.
 *
 * This file mirrors SCHEMA.md exactly (event types, fields, enums). It is the
 * single place that decides which fields may ever be serialized and sent. The
 * serializer (serialize.ts) enforces `additionalProperties: false` against these
 * definitions: any key, value, type, or enum member not declared here is rejected
 * before any network I/O.
 *
 * There is deliberately NO generic "extra" / "meta" / "data" field. Adding or
 * changing a field means editing this file AND SCHEMA.md in the same public PR
 * (CI fails if one changes without the other).
 *
 * NOTE ON `country`: SCHEMA.md lists `country` in the envelope, but it is
 * resolved at ingest from the request IP and then the IP is discarded. The
 * client never computes or sends it, so it is intentionally absent below.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { LANGUAGES } from './data/languages.js';
import { FRAMEWORKS } from './data/frameworks.js';
import { isKnownService } from './data/services.js';

export const SCHEMA_VERSION = '0.1.0';

// ---- enums (verbatim from SCHEMA.md) ---------------------------------------
export const AGENTS = ['claude-code', 'cursor', 'codex'] as const;
export const ECOSYSTEMS = ['npm', 'pypi', 'cargo', 'go'] as const;
export const ENDED_BY = ['user', 'agent', 'error'] as const;
export const INITIATED_BY = ['agent', 'user_prompt'] as const;
export const ERROR_CATEGORIES = ['build', 'test', 'type', 'runtime', 'tool'] as const;

export const EVENT_TYPES = ['session', 'dependency_added', 'api_domain_used', 'error'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// ---- field-value checks -----------------------------------------------------
// Tight by construction: no whitespace, no paths, no URLs, no hostnames except
// the known-services list. serialize.ts adds a second, generic forbidden-content
// sweep on top of these.
export type Check = (v: unknown) => boolean;

const isStr = (v: unknown): v is string => typeof v === 'string';
const isBool = (v: unknown): boolean => typeof v === 'boolean';
const isInt = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v) && v >= 0;
const oneOf =
  (set: readonly string[]): Check =>
  (v) => isStr(v) && set.includes(v);
const matches =
  (re: RegExp): Check =>
  (v) => isStr(v) && re.test(v);

export const PATTERNS = {
  panelist_id: /^p_[0-9a-f-]{8,}$/,
  agent_version: /^[0-9A-Za-z][0-9A-Za-z.\-+]{0,63}$/,
  model: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
  version: /^v?[0-9][0-9A-Za-z.\-+]{0,63}$/,
  // npm allows one optional @scope/ prefix; the others are single tokens.
  pkg_npm: /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
  pkg_token: /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/,
} as const;

const packageCheck: Check = (v) =>
  isStr(v) && (PATTERNS.pkg_npm.test(v) || PATTERNS.pkg_token.test(v));

// ---- field specs ------------------------------------------------------------
export interface FieldSpec {
  name: string;
  required: boolean;
  check: Check;
}

const ENVELOPE: FieldSpec[] = [
  { name: 'schema_version', required: true, check: (v) => v === SCHEMA_VERSION },
  { name: 'panelist_id', required: true, check: matches(PATTERNS.panelist_id) },
  // Unix seconds, truncated to the hour (SCHEMA.md) — enforce the truncation.
  { name: 'ts', required: true, check: (v) => isInt(v) && (v as number) % 3600 === 0 },
  { name: 'agent', required: true, check: oneOf(AGENTS) },
  { name: 'agent_version', required: true, check: matches(PATTERNS.agent_version) },
];

// Envelope discriminator (SCHEMA.md envelope table): names which event this is,
// validated against the closed set of event types.
const TYPE_FIELD: FieldSpec = { name: 'type', required: true, check: oneOf(EVENT_TYPES) };

const EVENTS: Record<EventType, FieldSpec[]> = {
  session: [
    { name: 'model', required: true, check: matches(PATTERNS.model) },
    { name: 'duration_s', required: true, check: isInt },
    { name: 'turns', required: true, check: isInt },
    { name: 'tokens_in', required: true, check: isInt },
    { name: 'tokens_out', required: true, check: isInt },
    { name: 'ended_by', required: true, check: oneOf(ENDED_BY) },
    // Optional: omitted entirely when detection is not confident (never guessed).
    { name: 'language', required: false, check: oneOf(LANGUAGES) },
    { name: 'framework', required: false, check: oneOf(FRAMEWORKS) },
  ],
  dependency_added: [
    { name: 'ecosystem', required: true, check: oneOf(ECOSYSTEMS) },
    { name: 'package', required: true, check: packageCheck },
    // Optional: present only when a concrete version is known (e.g. from a diff).
    { name: 'version', required: false, check: matches(PATTERNS.version) },
    { name: 'initiated_by', required: true, check: oneOf(INITIATED_BY) },
  ],
  api_domain_used: [{ name: 'domain', required: true, check: (v) => isStr(v) && isKnownService(v) }],
  error: [
    { name: 'category', required: true, check: oneOf(ERROR_CATEGORIES) },
    { name: 'retries', required: true, check: isInt },
    { name: 'resolved', required: true, check: isBool },
  ],
};

/** All fields allowed on an event of this type: envelope + type tag + body. */
export function fieldsFor(type: EventType): FieldSpec[] {
  return [...ENVELOPE, TYPE_FIELD, ...EVENTS[type]];
}

/** Short hash of SCHEMA.md, printed by `init`/`inspect` so users can pin it. */
export function schemaHash(): string {
  const p = fileURLToPath(new URL('../SCHEMA.md', import.meta.url));
  return createHash('sha256').update(readFileSync(p)).digest('hex').slice(0, 12);
}
