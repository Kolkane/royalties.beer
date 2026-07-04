#!/usr/bin/env node
// The `royalties` binary. Dispatches subcommands, plus the internal `__hook`
// entry that Claude Code invokes with a hook payload on stdin.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  cmdDoctor,
  cmdExport,
  cmdInit,
  cmdInspect,
  cmdPause,
  cmdPurge,
  cmdResume,
  cmdStats,
  cmdUninstall,
} from './commands.js';
import { handleHook, type HookInput } from './hooks/handle.js';

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'init':
      return cmdInit();
    case 'uninstall':
      return cmdUninstall();
    case 'stats':
      return cmdStats();
    case 'inspect':
      return cmdInspect();
    case 'doctor':
      return cmdDoctor();
    case 'pause':
      return cmdPause();
    case 'resume':
      return cmdResume();
    case 'purge':
      return cmdPurge();
    case 'export':
      return cmdExport();
    case '__hook':
      return runHook();
    case 'version':
    case '--version':
    case '-v':
      return printVersion();
    default:
      return printHelp();
  }
}

async function runHook(): Promise<void> {
  try {
    const input = JSON.parse(await readStdin()) as HookInput;
    await handleHook(input);
  } catch {
    // A collector bug must never break the user's agent — swallow everything.
  }
  process.exit(0);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', () => resolve(data));
  });
}

function printVersion(): void {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version: string };
  console.log(pkg.version);
}

function printHelp(): void {
  console.log(`royalties — get paid for your AI coding metadata, never your code.

Usage: royalties <command>

  init        Install the Claude Code hooks and start collecting.
  uninstall   Remove the hooks (keeps local data).
  stats       Show your local stats.
  inspect     Print the exact pending payload. Sends nothing.
  doctor      Show health + the last hook's fields (with ROYALTIES_DEBUG=1).
  pause       Stop collecting until 'resume'.
  resume      Resume collecting.
  purge       Delete local data and request server-side erasure.
  export      Print all your events as JSON.

The whitelist of what can ever be sent lives in SCHEMA.md.`);
}

void main();
