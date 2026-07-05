// The user-facing commands. Each is small and does exactly what it says; none of
// them sends anything except `init`/`purge` (delivery + server-side deletion) and
// they all operate on local files first.
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { CLAUDE_SETTINGS_PATH, isDebug, paths } from './config.js';
import { install, statusInstalled, uninstall } from './hooks/install.js';
import { SCHEMA_VERSION, schemaHash } from './schema.js';
import { getPanelistId, peekPanelistId } from './panelist.js';
import { clear, readEvents, readLines } from './queue.js';
import { flush, requestServerPurge } from './send.js';
import { ensureRegistered } from './register.js';
import { buildEvents, finalizeStale } from './finalize.js';
import { isPaused } from './ignore.js';
import { isHookDebug, readHookDebug } from './debug.js';
import { deleteState, listStates } from './state.js';

export async function cmdInit(): Promise<void> {
  const panelistId = getPanelistId();
  const result = install();
  console.log('royalties initialized.');
  console.log(`  panelist id : ${panelistId}`);
  console.log(`  schema      : v${SCHEMA_VERSION} (${schemaHash()})`);
  console.log(`  settings    : ${result.settingsPath}`);
  console.log(
    result.alreadyInstalled
      ? '  hooks       : already installed'
      : '  hooks       : installed (SessionStart, PostToolUse, Stop, SessionEnd)',
  );
  const auth = await ensureRegistered().catch(() => null);
  console.log(
    auth
      ? '  panel       : registered (auth token stored locally)'
      : '  panel       : not registered yet — will retry automatically on the next send',
  );
  console.log('\nOnly the fields in SCHEMA.md ever leave your machine.');
  console.log('Run `royalties inspect` to see exactly what would be sent — it sends nothing.');
  finalizeStale(panelistId);
  await flush().catch(() => undefined);
}

export function cmdUninstall(): void {
  const result = uninstall();
  console.log(`Hooks removed from ${result.settingsPath} (${result.restored}).`);
  console.log('Local data kept. Run `royalties purge` to delete it and request server-side erasure.');
}

export function cmdInspect(): void {
  console.log(`royalties inspect — schema v${SCHEMA_VERSION} (${schemaHash()}). Nothing is sent.\n`);
  const pending = readEvents(paths.queue);
  console.log(`Pending (queued, not yet sent): ${pending.length} event(s)`);
  for (const event of pending) console.log('  ' + JSON.stringify(event));

  const states = listStates();
  if (states.length > 0) {
    const panelistId = peekPanelistId() ?? 'p_preview';
    console.log(`\nPreview of ${states.length} in-progress session(s) — not yet queued:`);
    for (const state of states) {
      for (const event of buildEvents(state, panelistId, Date.now())) {
        console.log('  ' + JSON.stringify(event));
      }
    }
  }
  if (pending.length === 0 && states.length === 0) {
    console.log('\nNothing pending yet. Code a session, then check again.');
  }
}

export function cmdStats(): void {
  const events = readEvents(paths.log);
  const counts: Record<string, number> = {};
  const packages = new Map<string, number>();
  const domains = new Map<string, number>();
  let sessions = 0;
  let tokensIn = 0;
  let tokensOut = 0;

  for (const event of events) {
    const type = String(event.type);
    counts[type] = (counts[type] ?? 0) + 1;
    if (type === 'session') {
      sessions++;
      tokensIn += toNum(event.tokens_in);
      tokensOut += toNum(event.tokens_out);
    } else if (type === 'dependency_added' && typeof event.package === 'string') {
      bump(packages, event.package);
    } else if (type === 'api_domain_used' && typeof event.domain === 'string') {
      bump(domains, event.domain);
    }
  }

  console.log('royalties stats (local)');
  console.log(`  panelist id : ${peekPanelistId() ?? '(none yet)'}`);
  console.log(`  events      : ${events.length} total, ${readLines(paths.queue).length} pending send`);
  console.log(`  sessions    : ${sessions}`);
  console.log(`  tokens      : ${tokensIn} in / ${tokensOut} out`);
  console.log(`  by type     : ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ') || '(none)'}`);
  console.log(`  top packages: ${top(packages)}`);
  console.log(`  top domains : ${top(domains)}`);
}

export function cmdExport(): void {
  process.stdout.write(JSON.stringify(readEvents(paths.log), null, 2) + '\n');
}

export function cmdDoctor(): void {
  console.log('royalties doctor');
  console.log(`  schema      : v${SCHEMA_VERSION} (${schemaHash()})`);
  console.log(`  panelist id : ${peekPanelistId() ?? '(none yet)'}`);
  console.log(`  home        : ${paths.home}`);
  console.log(`  settings    : ${CLAUDE_SETTINGS_PATH}`);
  console.log(`  hooks       : ${statusInstalled() ? 'installed' : 'not installed'}`);
  console.log(`  paused      : ${isPaused()}`);
  console.log(`  queued/log  : ${readLines(paths.queue).length} pending, ${readLines(paths.log).length} in history`);
  console.log(`  sessions    : ${listStates().length} in progress`);
  console.log(`  debug       : ${isDebug() ? 'on' : 'off (set ROYALTIES_DEBUG=1 to record hook fields)'}`);

  const byTool = readHookDebug();
  const records = byTool ? Object.values(byTool).filter(isHookDebug) : [];
  if (records.length === 0) {
    console.log('\nNo hook payload recorded yet. Set ROYALTIES_DEBUG=1, run a Bash command in a session, then re-run `royalties doctor`.');
    return;
  }
  records.sort((a, b) => a.at.localeCompare(b.at));
  console.log('\nLast payload per tool (field names only — never values):');
  for (const rec of records) {
    console.log(JSON.stringify(rec, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
    if (rec.tool_name === 'Bash') {
      console.log(
        rec.exit_code_found
          ? `  => exit code ${rec.exit_code} seen via \`${rec.exit_code_source}\`; a non-zero code produces an 'error' event.`
          : "  => no exit-code field seen — 'error' events fail closed (none produced). Check `tool_response_keys` above for the field carrying it, then report it and we'll add it.",
      );
    }
  }
}

export function cmdPause(): void {
  mkdirSync(paths.home, { recursive: true });
  writeFileSync(paths.paused, new Date().toISOString() + '\n');
  console.log('Paused. No events are collected until `royalties resume`.');
}

export function cmdResume(): void {
  if (existsSync(paths.paused)) rmSync(paths.paused);
  console.log('Resumed.');
}

export async function cmdPurge(): Promise<void> {
  const panelistId = peekPanelistId();
  const server = panelistId ? await requestServerPurge(panelistId) : false;

  clear(paths.queue);
  clear(paths.log);
  for (const state of listStates()) deleteState(state.session_id);
  if (existsSync(paths.panelist)) rmSync(paths.panelist);

  console.log('Local queue, history and session state deleted.');
  if (!panelistId) {
    console.log('No panelist id found; nothing to erase server-side.');
  } else if (server) {
    console.log(`Server-side deletion requested for ${panelistId}.`);
  } else {
    console.log(`Could not reach the server to erase ${panelistId}. Retry later or reach us at https://x.com/royaltiesdev.`);
  }
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function top(map: Map<string, number>): string {
  const items = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  return items.length > 0 ? items.map(([k, v]) => `${k}(${v})`).join(', ') : '(none)';
}

function toNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
