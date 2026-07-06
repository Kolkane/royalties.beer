// One-time panelist registration. `royalties init` (and, lazily, the sender)
// calls this to obtain a bearer token bound to the panelist id. Offline-safe:
// any failure returns null and leaves the collector to try again later — nothing
// is ever blocked on the network.
import { INVITE_CODE, REGISTER_ENDPOINT } from './config.js';
import { getAuth, getPanelistId, saveToken, type Auth } from './panelist.js';

export async function ensureRegistered(): Promise<Auth | null> {
  return getAuth() ?? (await register());
}

export async function register(): Promise<Auth | null> {
  // Always our own persistent id — NEVER mint a new one here. Forking the
  // identity breaks payouts (a lost token must never change who we are).
  const panelistId = getPanelistId();

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
  // 403 (invite required) / 5xx / anything else: give up quietly, retry later.
  return null;
}
