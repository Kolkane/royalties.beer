// Formats a fatal command error for the terminal. Deliberately side-effect-free
// (no console / process access) so it is trivially testable; cli.ts does the
// printing and sets the exit code. Commands should fail with a readable one-line
// message, not a raw stack trace — the stack is available with ROYALTIES_DEBUG=1.
export function formatFatal(err: unknown, debug: boolean): string {
  const message = err instanceof Error ? err.message : String(err);
  const line = `royalties: ${message}`;
  return debug && err instanceof Error && err.stack ? `${line}\n${err.stack}` : line;
}
