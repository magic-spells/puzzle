// the example's whole auth layer, in one plain module. it is a pattern to
// copy, not a library: it holds the tokens, sends them, keeps them fresh,
// and clears everything on sign out.
//
// the moving parts, and the framework tool each one leans on:
// - authorize()    → the app's beforeRequest hook adds the bearer token (D91)
// - requireAuth()  → a route guard; it awaits a refresh before letting you in (D87)
// - signIn() etc.  → custom adapter actions on the session model (D158)
// - the session record in the store is what views read to know who is signed
//   in, so the layout and pages re-render on sign in and sign out (D161)
//
// what lives where:
// - the access token: memory only. short-lived (30 seconds in the mock, so
//   you can watch it refresh) and never written to storage.
// - the refresh token and the user: localStorage, so a reload keeps you signed
//   in. that is a demo choice. a real app would rather have the server set the
//   refresh token as an httpOnly cookie, and send `credentials: 'include'`
//   from authorize() instead of a token in the body.

// the localStorage key for { refreshToken, user }
const STORAGE_KEY = 'puzzle-auth-example';

// refresh this long before the access token runs out, so a request sent just
// before expiry still lands with a live token
const REFRESH_EARLY_MS = 10_000;

// the one session record's id
const SESSION_ID = 'current';

/** @type {{ accessToken: string, refreshToken: string, expiresAt: number } | null} */
let tokens = null;

// the refresh that is running, shared by every caller (see refresh())
/** @type {Promise<void> | null} */
let refreshing = null;

// the timer that refreshes ahead of expiry while the tab stays open
/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;

/**
 * is someone signed in right now? a plain read for guards and handlers.
 * views read the session record instead, so they re-render when it changes.
 * @returns {boolean}
 */
export function isSignedIn() {
  return tokens !== null;
}

/**
 * the app's beforeRequest hook (D91): add the access token to every adapter
 * request. synchronous by contract, so it can only send the token it has; the
 * guard and withFreshToken() make sure that token is fresh first.
 * @param {RequestInit} init the request about to go out
 * @param {{ type: string, method: string, url: string }} context
 * @returns {RequestInit | undefined} a replacement init, or nothing to send as is
 */
export function authorize(init, { type }) {
  // the auth endpoints identify you by the refresh token in the body, and an
  // expired bearer on /refresh would only confuse a strict server
  if (!tokens?.accessToken || type === 'session') return undefined;
  // spread the old headers in: a bare replacement would drop Content-Type
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${tokens.accessToken}` } };
}

/**
 * sign in with an email and password. throws the server's error on failure,
 * which the sign-in form maps onto its fields.
 * @param {any} store the app's store (this.ctx.store in a view)
 * @param {{ email: string, password: string }} credentials
 */
export async function signIn(store, credentials) {
  const result = await store.adapter('session').signIn(credentials);
  accept(store, result);
}

/**
 * trade the refresh token for a new token pair. concurrent callers share one
 * request: three views waking up to an expired token send one /refresh, not
 * three (the mock rotates refresh tokens, so three would sign you out).
 * a refused refresh means the session is over, so it clears it and rethrows.
 * @param {any} store
 * @returns {Promise<void>}
 */
export function refresh(store) {
  if (refreshing) return refreshing;
  if (!tokens) return Promise.reject(new Error('Not signed in.'));
  const refreshToken = tokens.refreshToken;
  refreshing = store
    .adapter('session')
    .refresh(refreshToken)
    .then(
      (result) => accept(store, result),
      (error) => {
        // 401: the refresh token expired or was revoked. anything else (the
        // network dropped) keeps the session so the next try can succeed.
        if (error?.status === 401) clearSession(store);
        throw error;
      }
    )
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/**
 * make sure the access token will still work for the next request. refreshes
 * when it is about to expire. resolves false when nobody is signed in or the
 * session could not be renewed, so a guard can send you to the sign-in page.
 * @param {any} store
 * @returns {Promise<boolean>}
 */
export async function ensureFresh(store) {
  if (!tokens) return false;
  if (tokens.expiresAt - Date.now() > REFRESH_EARLY_MS) return true;
  try {
    await refresh(store);
    return true;
  } catch {
    return isSignedIn();
  }
}

/**
 * run a request from an event handler, and if the server still answers 401
 * (a token revoked server-side, a laptop that slept through the timer),
 * refresh once and run it again. data() reads don't need this: the guard
 * refreshed before the page loaded, and the error view covers a 401 there.
 * @template T
 * @param {any} store
 * @param {() => Promise<T>} request
 * @returns {Promise<T>}
 */
export async function withFreshToken(store, request) {
  await ensureFresh(store);
  try {
    return await request();
  } catch (error) {
    if (/** @type {any} */ (error)?.status !== 401) throw error;
    // throws, and signs you out, when the refresh token is dead too
    await refresh(store);
    return request();
  }
}

/**
 * sign out: revoke the refresh token on the server, then forget everything
 * locally. the local half runs even when the server call fails, because
 * staying signed in after pressing "sign out" is the worse outcome.
 * @param {any} store
 */
export async function signOut(store) {
  const refreshToken = tokens?.refreshToken;
  clearSession(store);
  if (!refreshToken) return;
  try {
    await store.adapter('session').signOut(refreshToken);
  } catch {
    // the local session is already gone; the server token expires on its own
  }
}

/**
 * bring a session back after a reload. call it from beforeMount, so the first
 * navigation's guard already knows whether you are signed in (D87's idiom).
 * @param {any} store
 */
export async function restore(store) {
  const saved = readStorage();
  if (!saved?.refreshToken) return;
  // expiresAt 0 makes the first ensureFresh() refresh right away
  tokens = { accessToken: '', refreshToken: saved.refreshToken, expiresAt: 0 };
  writeSession(store, saved.user, 0);
  try {
    await refresh(store);
  } catch {
    // refused: refresh() already cleared it. offline: keep the saved session
    // and let the next guard try again.
  }
}

/**
 * forget the session locally, with no request: tokens, storage, the timer,
 * the session record, and every note the user loaded. the next user must not
 * see the last one's notes, and their first findMany('note') must fetch.
 * @param {any} store
 */
export function clearSession(store) {
  tokens = null;
  if (timer) clearTimeout(timer);
  timer = null;
  writeStorage(null);
  store.findOne('session', SESSION_ID)?.destroy();
  // destroy() drops each record; invalidate() then forgets that the
  // collection was loaded, so the next read goes back to the server
  for (const note of [...store.findMany('note')]) note.destroy();
  store.invalidate('note');
}

/**
 * a route guard for pages that need a signed-in user (D87). returns a named
 * redirect (D196) to the sign-in page, which brings you back afterwards.
 * @param {{ to: { path: string }, ctx: { store: any } }} navigation
 */
export async function requireAuth({ to, ctx }) {
  if (await ensureFresh(ctx.store)) return true;
  return { name: 'login', query: { redirect: to.path } };
}

/**
 * a route guard for the sign-in page: someone already signed in goes on to
 * the dashboard instead.
 */
export function guestOnly() {
  if (isSignedIn()) return { name: 'dashboard' };
  return true;
}

/**
 * store a fresh token pair from /login or /refresh and update the session
 * record, which re-renders every view that reads it.
 * @param {any} store
 * @param {{ user: any, accessToken: string, refreshToken: string, expiresIn: number }} result
 */
function accept(store, { user, accessToken, refreshToken, expiresIn }) {
  const expiresAt = Date.now() + expiresIn * 1000;
  tokens = { accessToken, refreshToken, expiresAt };
  writeStorage({ refreshToken, user });
  writeSession(store, user, expiresAt);
  schedule(store, expiresAt);
}

/**
 * create or update the one session record.
 * @param {any} store
 * @param {{ id: number, name: string, email: string }} user
 * @param {number} expiresAt
 */
function writeSession(store, user, expiresAt) {
  const fields = { userId: user.id, name: user.name, email: user.email, expiresAt };
  const session = store.findOne('session', SESSION_ID);
  if (session) session.update(fields);
  else store.createRecord('session', { id: SESSION_ID, ...fields });
}

/**
 * refresh in the background shortly before the access token expires, so an
 * open tab never sends a dead token. a failed refresh is fine here: the next
 * guard or withFreshToken() tries again, or sends you to sign in.
 * @param {any} store
 * @param {number} expiresAt
 */
function schedule(store, expiresAt) {
  if (timer) clearTimeout(timer);
  const wait = Math.max(0, expiresAt - Date.now() - REFRESH_EARLY_MS);
  timer = setTimeout(() => {
    timer = null;
    refresh(store).catch(() => {});
  }, wait);
}

/**
 * read the saved session, or null. storage can throw (private mode, blocked
 * cookies), and a broken entry should read as signed out, not crash the app.
 * @returns {{ refreshToken: string, user: any } | null}
 */
function readStorage() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

/**
 * save the session, or remove it when value is null.
 * @param {{ refreshToken: string, user: any } | null} value
 */
function writeStorage(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage is unavailable: the session just won't survive a reload
  }
}
