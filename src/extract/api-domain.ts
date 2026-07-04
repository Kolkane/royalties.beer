// api_domain_used extraction. Scans generated file content for the exact domain
// strings in the known-services list and returns only those matches — the file
// content itself never leaves this function.
import { KNOWN_SERVICES } from '../data/services.js';

export function domainsInContent(content: string): string[] {
  if (!content) return [];
  const found: string[] = [];
  for (const domain of KNOWN_SERVICES) {
    if (content.includes(domain)) found.push(domain);
  }
  return found;
}
