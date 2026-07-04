// The envelope every event carries. `country` is deliberately not here: it is
// resolved at ingest from the request IP, which is then discarded (SCHEMA.md).
import { AGENT } from './config.js';
import { SCHEMA_VERSION } from './schema.js';

export interface Envelope {
  schema_version: string;
  panelist_id: string;
  ts: number;
  agent: string;
  agent_version: string;
}

/** Unix seconds truncated to the hour, as required by SCHEMA.md. */
export function hourTs(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / 1000 / 3600) * 3600;
}

export function makeEnvelope(
  panelistId: string,
  agentVersion: string,
  ts: number = hourTs(),
): Envelope {
  return {
    schema_version: SCHEMA_VERSION,
    panelist_id: panelistId,
    ts,
    agent: AGENT,
    agent_version: agentVersion,
  };
}
