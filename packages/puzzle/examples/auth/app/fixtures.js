// the mock backend for `puzzle dev --fixtures` (D98). inert without the flag.
//
// it plays a small auth server and one protected api:
// - POST /api/auth/login    email + password → a token pair
// - POST /api/auth/refresh  refresh token → a new pair (the old one is spent)
// - POST /api/auth/logout   revoke a refresh token
// - GET/POST /api/notes     only with `Authorization: Bearer <live access token>`
//
// tokens are signed json, not random ids, so a page reload (which starts a
// fresh mock) still accepts the refresh token saved in localStorage. the
// "signature" is a toy hash: enough for the mock to reject an edited or
// expired token, and nothing like real crypto. a real server signs with a
// secret it never ships to the browser.

// the demo accounts. sign in with either one.
const USERS = [
  { id: 1, name: 'Ada Lovelace', email: 'ada@example.com', password: 'puzzle' },
  { id: 2, name: 'Grace Hopper', email: 'grace@example.com', password: 'puzzle' },
];

// short on purpose, so you can watch the access token refresh
const ACCESS_SECONDS = 30;
const REFRESH_SECONDS = 60 * 60 * 24;

// refresh tokens that were used or revoked. memory only, like the rest of the
// mock: a reload forgets them, which is fine for a demo.
const spent = new Set();

/**
 * a toy string hash (djb2), standing in for an hmac.
 * @param {string} text
 * @returns {string}
 */
function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * issue a token: kind.payload.signature, where the payload is base64 json.
 * @param {'access' | 'refresh'} kind
 * @param {number} userId
 * @param {number} seconds lifetime
 * @returns {string}
 */
function issue(kind, userId, seconds) {
  // the random part keeps two tokens issued in the same millisecond distinct
  const payload = btoa(JSON.stringify({ sub: userId, exp: Date.now() + seconds * 1000, n: Math.random() }));
  return `${kind}.${payload}.${hash(`mock-secret.${kind}.${payload}`)}`;
}

/**
 * check a token and return its user, or null when it is malformed, edited,
 * the wrong kind, or expired.
 * @param {string | undefined} token
 * @param {'access' | 'refresh'} kind
 * @returns {typeof USERS[number] | null}
 */
function verify(token, kind) {
  const [tokenKind, payload, signature] = String(token ?? '').split('.');
  if (tokenKind !== kind || !payload || signature !== hash(`mock-secret.${kind}.${payload}`)) return null;
  try {
    const { sub, exp } = JSON.parse(atob(payload));
    if (exp <= Date.now()) return null;
    return USERS.find((user) => user.id === sub) ?? null;
  } catch {
    return null;
  }
}

/**
 * the response for a successful login or refresh. the user never includes
 * the password.
 * @param {typeof USERS[number]} user
 */
function tokenPair(user) {
  return {
    status: 200,
    body: {
      user: { id: user.id, name: user.name, email: user.email },
      accessToken: issue('access', user.id, ACCESS_SECONDS),
      refreshToken: issue('refresh', user.id, REFRESH_SECONDS),
      expiresIn: ACCESS_SECONDS,
    },
  };
}

/** a 401 with a message, the way the api says "who are you?" */
const unauthorized = (error) => ({ status: 401, body: { error } });

// some notes to find on first sign in. userId says whose each one is.
const NOTES = [
  { id: 1, userId: 1, text: 'Write the first program.', createdAt: '1843-09-01' },
  { id: 2, userId: 1, text: 'Explain why the engine can do more than arithmetic.', createdAt: '1843-09-02' },
  { id: 3, userId: 2, text: 'Find the moth in relay 70.', createdAt: '1947-09-09' },
];

export default {
  seed: 1,

  mock: {
    // the session model has no endpoint, so its paths are relative to apiURL:
    // `/auth/login`, `/auth/refresh`, `/auth/logout`
    session: {
      latency: [150, 350],
      handler({ method, path, body }) {
        if (method !== 'POST') return { status: 404, body: { error: 'Not found.' } };

        if (path === '/auth/login') {
          const user = USERS.find((u) => u.email === body?.email?.trim().toLowerCase());
          if (!user || user.password !== body?.password) {
            // keyed by field, so the sign-in form shows it under the password
            return { status: 401, body: { errors: { password: 'Wrong email or password.' } } };
          }
          return tokenPair(user);
        }

        if (path === '/auth/refresh') {
          const user = spent.has(body?.refreshToken) ? null : verify(body?.refreshToken, 'refresh');
          if (!user) return unauthorized('Your session has ended. Sign in again.');
          // rotation: each refresh token works once. a stolen one that is
          // replayed after the real tab used it gets refused.
          spent.add(body.refreshToken);
          return tokenPair(user);
        }

        if (path === '/auth/logout') {
          if (body?.refreshToken) spent.add(body.refreshToken);
          return { status: 204 };
        }

        return { status: 404, body: { error: 'Not found.' } };
      },
    },

    // the protected api. every request needs a live access token, and a user
    // only ever sees and creates their own notes.
    note: {
      data: NOTES,
      latency: [150, 400],
      handler({ method, path, body, headers, collection }) {
        const token = headers.authorization?.replace(/^Bearer /, '');
        const user = verify(token, 'access');
        if (!user) return unauthorized('Your session has expired.');

        // GET /notes: this user's notes only, oldest first
        if (method === 'GET' && path === '') {
          const mine = [...collection.values()].filter((note) => note.userId === user.id);
          return { status: 200, body: mine.map(({ userId, ...note }) => note) };
        }

        // POST /notes: the server assigns the id, the owner and the date
        if (method === 'POST' && path === '') {
          const id = Math.max(0, ...collection.keys()) + 1;
          const note = { id, userId: user.id, text: String(body?.text ?? ''), createdAt: new Date().toISOString().slice(0, 10) };
          collection.set(id, note);
          const { userId, ...echo } = note;
          return { status: 201, body: echo };
        }

        // anything else (GET or DELETE /notes/:id) must be one of theirs,
        // then the default crud serves it
        const id = Number(path.slice(1));
        if (collection.get(id)?.userId !== user.id) return { status: 404, body: { error: 'Not found.' } };
        return null;
      },
    },
  },
};
