import { PuzzleModel, Puzzle } from '@magic-spells/puzzle';
import { PuzzleAdapterError } from '@magic-spells/puzzle/adapter';

// where the auth endpoints live. custom adapter actions get the raw url, so
// this repeats app.js's apiURL; the generated verbs are the only ones the
// framework prefixes for you (D158).
const AUTH_URL = '/api/auth';

/**
 * read a json response, or throw the same error the generated verbs throw.
 * a PuzzleAdapterError carries status and body, so the sign-in form maps a
 * server's { errors: { password } } onto its field (D192).
 * @param {Response} res
 * @returns {Promise<any>}
 */
async function json(res) {
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new PuzzleAdapterError(res.status, res.statusText, body);
  return body;
}

/**
 * build a json POST init.
 * @param {object} body
 * @returns {RequestInit}
 */
function post(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * the signed-in user, as one local record with id 'current'.
 *
 * views read it with findOne('session', 'current'): a record means signed in,
 * null means signed out, and every view that read it re-renders when it
 * changes. the tokens are NOT here: they stay in app/auth.js, out of the
 * store, so devtools and store snapshots never show them.
 *
 * the adapter declares no endpoint and none of the five verbs, so this model
 * is local: a tracked find never fetches it (D161). it only carries three
 * custom actions, reached as store.adapter('session').signIn(...). their
 * `fetch` argument runs beforeRequest and the fixtures mock, like every
 * adapter request does (D158).
 */
export default class Session extends PuzzleModel {
  static schema = {
    id: Puzzle.string().primary(),
    userId: Puzzle.number().required(),
    name: Puzzle.string().default(''),
    email: Puzzle.string().default(''),
    // when the current access token stops working, in epoch milliseconds
    expiresAt: Puzzle.number().default(0),
  };

  static adapter = {
    /**
     * POST /api/auth/login with an email and password.
     * @param {typeof fetch} fetch the adapter's fetch (hook + mocks)
     * @param {{ email: string, password: string }} credentials
     * @returns {Promise<{ user: object, accessToken: string, refreshToken: string, expiresIn: number }>}
     */
    signIn: async (fetch, credentials) => json(await fetch(`${AUTH_URL}/login`, post(credentials))),

    /**
     * POST /api/auth/refresh: trade a refresh token for a new pair.
     * @param {typeof fetch} fetch
     * @param {string} refreshToken
     */
    refresh: async (fetch, refreshToken) => json(await fetch(`${AUTH_URL}/refresh`, post({ refreshToken }))),

    /**
     * POST /api/auth/logout: revoke the refresh token on the server.
     * @param {typeof fetch} fetch
     * @param {string} refreshToken
     */
    signOut: async (fetch, refreshToken) => json(await fetch(`${AUTH_URL}/logout`, post({ refreshToken }))),
  };
}
