// Two append-only JSONL files of already-serialized events:
//   queue.jsonl — pending send; drained as batches are accepted by ingest.
//   log.jsonl   — full local history for `stats` / `export`; wiped by `purge`.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { paths } from './config.js';

function ensureDir(file: string): void {
  mkdirSync(dirname(file), { recursive: true });
}

export function appendLine(file: string, line: string): void {
  ensureDir(file);
  appendFileSync(file, line + '\n');
}

export function readLines(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((l) => l.length > 0);
}

export function readEvents(file: string): Record<string, unknown>[] {
  return readLines(file).map((l) => JSON.parse(l) as Record<string, unknown>);
}

export function writeLines(file: string, lines: string[]): void {
  ensureDir(file);
  writeFileSync(file, lines.length ? lines.join('\n') + '\n' : '');
}

export function clear(file: string): void {
  if (existsSync(file)) rmSync(file);
}

/** Record a serialized event: pending for send, and kept in local history. */
export function enqueue(serialized: string): void {
  appendLine(paths.queue, serialized);
  appendLine(paths.log, serialized);
}
