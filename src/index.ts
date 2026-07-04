// Public, audit-friendly surface. `serialize` is the entire trust boundary:
// nothing leaves the machine except through it, and it enforces the whitelist in
// schema.ts / SCHEMA.md. Everything else here is read-only introspection.
export { serialize, validate, isAllowed, forbidden, Rejected, type Event } from './serialize.js';
export { SCHEMA_VERSION, EVENT_TYPES, schemaHash, type EventType } from './schema.js';
export { KNOWN_SERVICES } from './data/services.js';
export { LANGUAGES } from './data/languages.js';
export { FRAMEWORKS } from './data/frameworks.js';
