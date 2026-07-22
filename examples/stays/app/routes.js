import HomeView from './views/Home.pzl';
import SearchView from './views/Search.pzl';
import ListingView from './views/Listing.pzl';
import AccountShell from './views/account/AccountShell.pzl';
import ProfileView from './views/account/Profile.pzl';
import TripsView from './views/account/Trips.pzl';
import WishlistView from './views/account/Wishlist.pzl';
import NotFoundView from './views/NotFound.pzl';

import MainLayout from './layouts/MainLayout.pzl';

// One layout for the whole app (constellation/doc/DOC-SPEC.md §12, D28): Home,
// Search, Listing, Account and 404 all share MainLayout, so navigating between
// them is a "view swap inside a reused layout" — the top header, footer and
// mobile tab bar stay mounted, only the <Slot/> animates.
//
// /account is a NESTED route (v1.3, D30): AccountShell renders its matched child
// pane (Profile / Trips / Wishlist) at its own <Slot/>. Child paths are RELATIVE;
// `path: ''` is the index child that fills the slot at the bare /account URL, so
// /account shows the profile. `layout` is a top-level-route-only field — the
// children inherit MainLayout from the chain. Swapping panes reuses AccountShell
// (its data() re-runs with the full merged params); only the leaf pane animates.
export default [
  { path: '/',            name: 'home',    view: HomeView,     layout: MainLayout, meta: { title: 'Puzzle Stays · Find your place' } },
  { path: '/search',      name: 'search',  view: SearchView,   layout: MainLayout, meta: { title: 'Stays · Puzzle Stays' } },
  { path: '/listing/:id', name: 'listing', view: ListingView,  layout: MainLayout, meta: { title: 'Stay · Puzzle Stays' } },
  {
    path: '/account',
    name: 'account',
    view: AccountShell,
    layout: MainLayout,
    meta: { title: 'Account · Puzzle Stays' },
    children: [
      { path: '',         name: 'account-profile',  view: ProfileView },
      { path: 'trips',    name: 'account-trips',    view: TripsView },
      { path: 'wishlist', name: 'account-wishlist', view: WishlistView },
    ],
  },
  { path: '*',            name: 'not-found', view: NotFoundView, layout: MainLayout, meta: { title: 'Not found · Puzzle Stays' } },
];
