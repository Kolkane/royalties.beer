// Loads the public, versioned known-services list. The `domain` field of an
// api_domain_used event MUST be one of these exact strings — anything else is
// dropped (see SCHEMA.md). The JSON is shipped next to this module and copied
// into dist/ at build time (scripts/copy-assets.mjs).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('./known-services.json', import.meta.url));

export const KNOWN_SERVICES: readonly string[] = JSON.parse(readFileSync(file, 'utf8'));

const set = new Set(KNOWN_SERVICES);

export function isKnownService(domain: string): boolean {
  return set.has(domain);
}
