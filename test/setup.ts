// Runs before each test file. Redirects all local state and the Claude settings
// file into a throwaway temp directory, and points the endpoint at a dead local
// address, so tests never touch the real ~/.royalties, ~/.claude, or network.
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const base = path.join(os.tmpdir(), 'royalties-test-' + randomUUID());
process.env.ROYALTIES_HOME = path.join(base, 'home');
process.env.ROYALTIES_CLAUDE_SETTINGS = path.join(base, 'claude', 'settings.json');
process.env.ROYALTIES_ENDPOINT = 'http://127.0.0.1:9/v1/events';

// A minimal fake source package so install()'s stable-bin copy works without the
// tests depending on a built dist/. Lives OUTSIDE ROYALTIES_HOME so resetAll()
// never wipes it; structurally real (dist/cli.js + package.json), contents fake.
const src = path.join(base, 'src-fixture');
mkdirSync(path.join(src, 'dist', 'hooks'), { recursive: true });
mkdirSync(path.join(src, 'dist', 'data'), { recursive: true });
writeFileSync(path.join(src, 'dist', 'cli.js'), '#!/usr/bin/env node\n// fake cli\n');
writeFileSync(path.join(src, 'dist', 'hooks', 'handle.js'), '// fake handle\n');
writeFileSync(path.join(src, 'dist', 'data', 'known-services.json'), '{}\n');
writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'royalties', version: '0.0.0-test' }) + '\n');
writeFileSync(path.join(src, 'SCHEMA.md'), '# fake schema\n');
process.env.ROYALTIES_SRC = src;
