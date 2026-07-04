// Runs before each test file. Redirects all local state and the Claude settings
// file into a throwaway temp directory, and points the endpoint at a dead local
// address, so tests never touch the real ~/.royalties, ~/.claude, or network.
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const base = path.join(os.tmpdir(), 'royalties-test-' + randomUUID());
process.env.ROYALTIES_HOME = path.join(base, 'home');
process.env.ROYALTIES_CLAUDE_SETTINGS = path.join(base, 'claude', 'settings.json');
process.env.ROYALTIES_ENDPOINT = 'http://127.0.0.1:9/v1/events';
