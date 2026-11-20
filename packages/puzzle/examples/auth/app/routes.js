import HomeView from './views/Home.pzl';
import LoginView from './views/Login.pzl';
import DashboardView from './views/Dashboard.pzl';
import AccountView from './views/Account.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';
import { requireAuth, guestOnly } from './auth.js';

// every route is named (D196), so links and redirects say { name: 'login' }
// and never spell a path twice.
//
// the guard field (D87) runs before the view is built. requireAuth awaits a
// token refresh when the access token is about to expire, then lets you in
// or redirects to /login?redirect=… so signing in brings you back.
export default [
  { path: '/', name: 'home', view: HomeView, layout: DefaultLayout, meta: { title: 'Puzzle auth' } },
  { path: '/login', name: 'login', view: LoginView, layout: DefaultLayout, guard: guestOnly, meta: { title: 'Sign in' } },
  { path: '/dashboard', name: 'dashboard', view: DashboardView, layout: DefaultLayout, guard: requireAuth, meta: { title: 'Your notes' } },
  { path: '/account', name: 'account', view: AccountView, layout: DefaultLayout, guard: requireAuth, meta: { title: 'Account' } },
  { path: '*', name: 'not-found', view: NotFoundView, layout: DefaultLayout, meta: { title: 'Not found' } },
];
