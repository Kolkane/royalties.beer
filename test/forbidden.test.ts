// The trust product: prove the serializer cannot emit anything but whitelisted
// metadata, and rejects forbidden content before any network I/O.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { forbidden, isAllowed, Rejected, serialize, validate } from '../src/serialize.js';
import { fieldsFor, SCHEMA_VERSION } from '../src/schema.js';

const envelope = {
  schema_version: SCHEMA_VERSION,
  event_id: '3b241101-e2bb-4255-8caf-4136c566a962', // valid UUID v4
  panelist_id: 'p_8f3a1b2c9d4e5f60',
  ts: 1751536800, // hour-aligned
  agent: 'claude-code',
  agent_version: '2.1.185',
};

const validSession = {
  ...envelope,
  type: 'session',
  model: 'claude-opus-4-8',
  duration_s: 1840,
  turns: 23,
  tokens_in: 184000,
  tokens_out: 52000,
  ended_by: 'agent',
};

// Real-world things that must NEVER leave the machine (SCHEMA.md forbidden list).
const FORBIDDEN_VALUES = [
  'https://api.stripe.com/v1/charges?key=sk_live_abc', // full URL + query string
  '/home/alice/project/src/index.ts', // unix file path
  'C:\\Users\\alice\\secret.txt', // windows path
  'const apiKey = "sk_live_x";\nfetch(url)', // code snippet
  'API_KEY=sk_live_deadbeef', // env var
  'alice@example.com', // email
  'Error: Cannot find module "foo" (line 42)', // error message
  'feature/new-login', // branch name
  'git@github.com:acme/private.git', // repo/host
];

describe('serializer whitelist', () => {
  it('accepts a valid event and round-trips it', () => {
    expect(() => serialize(validSession)).not.toThrow();
    expect(JSON.parse(serialize(validSession))).toEqual(validSession);
  });

  it('rejects any key outside the whitelist (additionalProperties: false)', () => {
    expect(() => validate({ ...validSession, secret: 'x' })).toThrow(Rejected);
    expect(() => validate({ ...validSession, extra: 1 })).toThrow(Rejected);
    expect(() => validate({ ...validSession, meta: {} })).toThrow(Rejected);
  });

  it('rejects an event with no event_id (idempotency key is required, fail closed)', () => {
    const { event_id, ...noId } = validSession;
    void event_id;
    expect(() => validate(noId)).toThrow(Rejected);
    // and a malformed one (not a UUID v4) is rejected too
    expect(() => validate({ ...validSession, event_id: 'not-a-uuid' })).toThrow(Rejected);
  });

  it('rejects nested objects / arrays / null (scalars only)', () => {
    expect(() => validate({ ...validSession, model: { a: 1 } })).toThrow(Rejected);
    expect(() => validate({ ...validSession, model: ['x'] })).toThrow(Rejected);
    expect(() => validate({ ...validSession, model: null })).toThrow(Rejected);
  });

  it('rejects forbidden content injected into any string field', () => {
    for (const bad of FORBIDDEN_VALUES) {
      expect(isAllowed({ ...validSession, model: bad }), `model=${bad}`).toBe(false);
      expect(
        isAllowed({ ...envelope, type: 'dependency_added', ecosystem: 'npm', package: bad, initiated_by: 'agent' }),
        `package=${bad}`,
      ).toBe(false);
    }
  });

  it('drops api_domain_used unless the domain is on the known-services list', () => {
    expect(isAllowed({ ...envelope, type: 'api_domain_used', domain: 'api.stripe.com' })).toBe(true);
    expect(isAllowed({ ...envelope, type: 'api_domain_used', domain: 'api.evil-tracker.com' })).toBe(false);
  });
});

describe('forbidden() catches universal red flags', () => {
  it('flags whitespace, URLs, paths, backslashes, angle brackets and "="', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 40 }),
        fc.constantFrom(' ', '\n', '\t', '://', '\\', '<', '>', '=', 'a/b/c', '..'),
        (s, bad) => forbidden(s + bad) === true,
      ),
    );
  });

  it('never flags clean single-token values', () => {
    for (const ok of ['claude-opus-4-8', '3.2.0', 'resend', '@vercel/node', 'api.stripe.com', 'v1.9.1']) {
      expect(forbidden(ok)).toBe(false);
    }
  });
});

describe('arbitrary objects are rejected', () => {
  const sessionKeys = new Set(fieldsFor('session').map((f) => f.name));

  it('any extra property makes an otherwise-valid event fail', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((k) => !sessionKeys.has(k)),
        fc.oneof(fc.string(), fc.integer(), fc.boolean()),
        (key, value) => isAllowed({ ...validSession, [key]: value }) === false,
      ),
    );
  });

  it('random dictionaries almost never validate, and never with an unknown type', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
        (obj) => {
          const type = (obj as Record<string, unknown>).type;
          const knownType = type === 'session' || type === 'dependency_added' || type === 'api_domain_used' || type === 'error';
          return knownType || isAllowed(obj) === false;
        },
      ),
    );
  });
});
