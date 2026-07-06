// A failed command prints one readable `royalties: <message>` line and exits
// non-zero; the full stack trace is shown only with ROYALTIES_DEBUG=1.
import { expect, it } from 'vitest';
import { formatFatal } from '../src/fatal.js';

it('prints a single "royalties: <message>" line by default — no stack', () => {
  const out = formatFatal(new Error('boom'), false);
  expect(out).toBe('royalties: boom');
  expect(out).not.toContain('\n');
});

it('appends the full stack only when debug is on', () => {
  const err = new Error('boom');
  const out = formatFatal(err, true);
  expect(out.startsWith('royalties: boom')).toBe(true);
  expect(out).toContain(err.stack!); // full stack included
  expect(out.split('\n').length).toBeGreaterThan(1);
});

it('handles a non-Error throw (no stack to add, even in debug)', () => {
  expect(formatFatal('nope', false)).toBe('royalties: nope');
  expect(formatFatal('nope', true)).toBe('royalties: nope');
});
