# Auth

A reference app for authentication in Puzzle: sign in, keep the session fresh
with token refresh, guard the pages that need a user, and sign out. It is a
pattern to copy, not an auth library. The whole auth layer is one plain module,
[`app/auth.js`](app/auth.js), built from tools Puzzle already has: route
guards, the adapter's `beforeRequest` hook, the store, and the error view.

There is no backend. The mock in [`app/fixtures.js`](app/fixtures.js) plays a
small auth server and a protected notes API, and checks the bearer token like a
real one would, so run it with fixtures:

```sh
npm install
puzzle dev --fixtures
```

Sign in as `ada@example.com` or `grace@example.com`, password `puzzle`.

## The flow

### 1. A guarded page sends you to sign in

`/dashboard` and `/account` declare `guard: requireAuth` in
[`app/routes.js`](app/routes.js). A guard runs before the page is built, so a
signed-out visit never constructs the page or sends its request (D87). It
redirects with a named target (D196) that remembers where you were going:

```js
export async function requireAuth({ to, ctx }) {
  if (await ensureFresh(ctx.store)) return true;
  return { name: 'login', query: { redirect: to.path } };
}
```

`/login` has the opposite guard, `guestOnly`, so a signed-in user skips it.

### 2. Signing in

[`views/Login.pzl`](app/views/Login.pzl) is a `/forms` form (D192). The
`Credentials` model only supplies the rules; it is never stored. On submit,
`signIn()` calls a custom adapter action on the session model:

```js
// models/session.js
static adapter = {
  signIn: async (fetch, credentials) => json(await fetch('/api/auth/login', post(credentials))),
  // refresh and signOut look the same
};
```

That `fetch` argument is the adapter's, not the global one, so it goes through
`beforeRequest` and the fixtures mock like every other request (D158). A wrong
password comes back as `401 { errors: { password: '…' } }`, and the form shows
it under the password field. A good one returns a token pair and the user, and
the form replaces the URL with the `redirect` it was given. The redirect is
checked first: only a path inside the app counts.

### 3. Who is signed in: the session record

`auth.js` writes one local `session` record (`id: 'current'`) with the user's
name, email and the token's expiry. Views read it like any other record:

```js
data() {
  return { session: this.ctx.store.findOne('session', 'current') };
}
```

A record means signed in, `null` means signed out, and every view that read it
re-renders when it changes. The layout's header and the pages both read it.
`share()` can't do this job, because a layout's `share()` does not reach its
routed page (D197).

The session model declares no endpoint and none of the five adapter verbs, so a
tracked find never fetches it (D161). The tokens are not in the record: they
stay in `auth.js`, out of the store, so DevTools and store snapshots never show
them.

### 4. Every request carries the token

`app.js` passes `authorize` as `beforeRequest` (D91). It runs on every adapter
request, generated or custom, and adds the header once for the whole app:

```js
export function authorize(init, { type }) {
  if (!tokens?.accessToken || type === 'session') return undefined;
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${tokens.accessToken}` } };
}
```

So [`views/Dashboard.pzl`](app/views/Dashboard.pzl) says nothing about auth.
Its `findMany('note')` sends `GET /api/notes` with the bearer, and the mock
answers 401 without a live one.

### 5. Token refresh

The access token lasts 30 seconds in the mock, so you can watch it renew on the
Account page. Three things keep it fresh, from most to least common:

- **A timer.** After each sign-in or refresh, `auth.js` schedules a refresh 10
  seconds before expiry, so an open tab never sends a dead token.
- **The guard.** `requireAuth` awaits `ensureFresh()`, which refreshes when the
  token is about to run out. A tab that slept through the timer renews before
  the protected page loads.
- **A 401 anyway.** The server can refuse a token that still looks fresh here
  (it was revoked). In `data()`, the failure renders the app's
  [`ErrorView`](app/views/ErrorView.pzl) (D145), which refreshes once and calls
  `retry()`. In a handler, `withFreshToken(store, () => note.save())` does the
  same around one request.

Refresh calls are shared: everything that asks while one is running waits for
that one. That matters because the mock rotates refresh tokens (each one works
once), as many real servers do. If a refresh is refused, the session is over:
`auth.js` clears it and the next guard sends you to sign in.

### 6. A reload keeps you signed in

The refresh token and the user are saved in `localStorage`, and the access
token stays in memory. `beforeMount` calls `restore()`, which trades the saved
refresh token for a new pair before the first navigation, so the first guard
already knows the answer (D66, D87).

`localStorage` keeps the example self-contained. A real app would rather have
the server set the refresh token as an `httpOnly` cookie and send
`credentials: 'include'` from `beforeRequest`, so page scripts can never read
it.

### 7. Signing out

The header's Sign out button leaves the protected page first, then calls
`signOut()`, which:

1. forgets the tokens, the saved session and the refresh timer,
2. destroys the session record, so every view that read it re-renders signed out,
3. destroys the user's notes and calls `store.invalidate('note')`, so the next
   user's first read fetches their own notes instead of the last user's, and
4. asks the server to revoke the refresh token. The local part happens even if
   that request fails.

Going home first matters: clearing the notes while the dashboard is still on
screen would re-run its `data()` with no token.

## Files

| File | What it shows |
| --- | --- |
| `app/auth.js` | The auth layer: tokens, `authorize`, `refresh`, `ensureFresh`, `withFreshToken`, the guards, `restore`, `signOut` |
| `app/app.js` | `beforeRequest`, `beforeMount`, `errorView` and an `onError` that leaves 401s to the error view |
| `app/routes.js` | Named routes with `guard: requireAuth` and `guard: guestOnly` |
| `app/models/session.js` | The local session record and the three custom auth actions |
| `app/models/note.js` | The protected resource, a plain `endpoint` model |
| `app/models/credentials.js` | The sign-in form's rules |
| `app/fixtures.js` | The mock auth server and notes API |
| `app/views/ErrorView.pzl` | Renew and retry after a 401 |

Guards are a convenience, not a security boundary: they decide what the browser
shows, and the server decides what it serves. The mock rejects notes requests
without a live token for that reason, and so should your API.

`tests/auth-example.test.js` runs this flow against the compiled views and the
same mock.
