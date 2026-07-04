// One-time panelist registration. `royalties init` (and, lazily, the sender)
// calls this to obtain a bearer token bound to the panelist id. Offline-safe:
// any failure returns null and leaves the collector to try again later — nothing
// is ever blocked on the network.
import { INVITE_CODE, REGISTER_ENDPOINT } from './config.js';
import { getAuth, getPanelistId, rotatePanelist, saveToken, type Auth } from './panelist.js';

export async function ensureRegistered(): Promise<Auth | null> {
  return getAuth() ?? (await register());
}

export async function register(): Promise<Auth | null> {
  let panelistId = getPanelistId();

  // At most two tries: a 409 means our id is taken but we lost its token, so we
  // rotate to a fresh id and register that once.
  for (let attempt = 0; attempt < 2; attempt++) {
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
      return null; // offline — retry on the next flush
    }

    if (res.status === 201) {
      const data = (await res.json()) as { panelist_id: string; token: string };
      saveToken(data.panelist_id, data.token);
      return { panelistId: data.panelist_id, token: data.token };
    }
    if (res.status === 409) {
      panelistId = rotatePanelist();
      continue;
    }
    return null; // 403 (invite required) or other — give up quietly
  }
  return null;
}
