// One-time panelist registration. `royalties init` (and, lazily, the sender)
// calls this to obtain a bearer token bound to the panelist id. Offline-safe:
// any failure returns null and leaves the collector to try again later — nothing
// is ever blocked on the network.
import { INVITE_CODE, REGISTER_ENDPOINT } from './config.js';
import { getAuth, markRegisterConflict, peekPanelistId, saveToken, type Auth } from './panelist.js';

export async function ensureRegistered(): Promise<Auth | null> {
  return getAuth() ?? (await register());
}

export async function register(): Promise<Auth | null> {
  // Our own persistent id, and ONLY if it already exists — NEVER mint one here.
  // Minting identity is `init`'s job alone (it calls getPanelistId() first, then
  // registers). The sender reaches this via a hook's flush, so peeking closes a
  // TOCTOU hole: if a concurrent `purge` deleted panelist.json after the hook's
  // entry guard passed, we must NOT resurrect the id the user just erased.
  const panelistId = peekPanelistId();
  if (!panelistId) return null;

  let res: Response;
  try {
    res = await fetch(REGISTER_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(INVITE_CODE ? { 'x-invite-code': INVITE_CODE } : {}),
      },
      body: JSON.stringify({ panelist_id: panelistId }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null; // offline — retry on the next flush with the same id
  }

  if (res.status === 201) {
    const data = (await res.json()) as { token: string };
    // Bind the token to OUR id; never adopt a server-suggested different id.
    saveToken(panelistId, data.token);
    return { panelistId, token: data.token };
  }
  // 409: the server already registered this id and holds its write-once token,
  // which we no longer have. We keep the id and stay unregistered rather than
  // rotate — the token needs manual recovery, but the identity stays stable.
  // Flag it so `royalties doctor` surfaces the stuck auth instead of failing
  // silently. 403 (invite required) / 5xx / anything else: give up quietly.
  if (res.status === 409) markRegisterConflict();
  return null;
}
