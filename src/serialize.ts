/**
 * serialize.ts — the send-path gate.
 *
 * `serialize(event)` is the ONLY way an event becomes a string bound for the
 * network. It refuses anything the whitelist (schema.ts) does not explicitly
 * allow, and adds a generic forbidden-content sweep so that even a value inside
 * an allowed field cannot smuggle out code, paths, URLs, emails, etc.
 *
 * Enforcement order (fail closed at the first violation):
 *   1. known event `type`
 *   2. no key outside the whitelist          (additionalProperties: false)
 *   3. every value is a scalar               (no nested objects/arrays/null)
 *   4. no string value matches forbidden      (see `forbidden` below)
 *   5. required fields present, each field passes its schema check
 */
import { EVENT_TYPES, fieldsFor, type EventType } from './schema.js';

/** Thrown when an event is not allowed to leave the machine. */
export class Rejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Rejected';
  }
}

export type Event = Record<string, string | number | boolean>;

export function validate(event: Record<string, unknown>): void {
  const type = event.type;
  if (typeof type !== 'string' || !EVENT_TYPES.includes(type as EventType)) {
    throw new Rejected(`unknown event type: ${String(type)}`);
  }

  const specs = fieldsFor(type as EventType);
  const allowed = new Set(specs.map((s) => s.name));

  for (const key of Object.keys(event)) {
    if (!allowed.has(key)) throw new Rejected(`field not in whitelist: ${key}`);
  }

  for (const [key, value] of Object.entries(event)) {
    const t = typeof value;
    if (value === null || (t !== 'string' && t !== 'number' && t !== 'boolean')) {
      throw new Rejected(`field ${key} must be a scalar`);
    }
    if (t === 'string' && forbidden(value as string)) {
      throw new Rejected(`field ${key} contains forbidden content`);
    }
  }

  for (const spec of specs) {
    if (!Object.prototype.hasOwnProperty.call(event, spec.name)) {
      if (spec.required) throw new Rejected(`missing required field: ${spec.name}`);
      continue;
    }
    if (!spec.check(event[spec.name])) throw new Rejected(`field ${spec.name} failed validation`);
  }
}

/** Validate, then serialize. Throws `Rejected` if the event is not whitelisted. */
export function serialize(event: Record<string, unknown>): string {
  validate(event);
  return JSON.stringify(event);
}

/** True if the CLI can safely serialize this event without throwing. */
export function isAllowed(event: Record<string, unknown>): boolean {
  try {
    validate(event);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generic red flags that no legitimate whitelisted value ever contains. This is
 * defence in depth on top of the per-field checks — it catches code snippets,
 * error messages, file paths, full URLs, query strings and env vars.
 */
export function forbidden(s: string): boolean {
  if (s.length > 200) return true; // no field is a paragraph of anything
  if (/[\s<>=\\]/.test(s)) return true; // whitespace, angle brackets, `=`, backslash
  if (s.includes('://')) return true; // full URL
  if (s.includes('..')) return true; // path traversal / relative paths
  if ((s.match(/\//g) ?? []).length > 1) return true; // >1 slash = a path, not a name
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true; // control characters
  }
  return false;
}
