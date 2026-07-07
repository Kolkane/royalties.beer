// Public, audit-friendly surface. `serialize` is the entire trust boundary:
// nothing leaves the machine except through it, and it enforces the whitelist in
// schema.ts / SCHEMA.md. Everything else here is read-only introspection.
export { serialize, validate, isAllowed, forbidden, Rejected, type Event } from './serialize.js';
export { SCHEMA_VERSION, EVENT_TYPES, schemaHash, type EventType } from './schema.js';
// Contribution-points scoring (public law — mirrors POINTS.md).
export {
  POINTS_TABLE,
  EARLY_PANELIST_MULTIPLIER,
  PROGRAM_LAUNCH_ISO,
  EARLY_WINDOW_DAYS,
  computePoints,
  isEarlyPanelist,
  type PointsBreakdown,
} from './points.js';
export { KNOWN_SERVICES } from './data/services.js';
export { LANGUAGES } from './data/languages.js';
export { FRAMEWORKS } from './data/frameworks.js';
