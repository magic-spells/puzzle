import OverviewView from './views/Overview.pzl';
import FleetView from './views/Fleet.pzl';
import MissionsView from './views/Missions.pzl';
import CrewView from './views/Crew.pzl';
import DetailView from './views/Detail.pzl';
import DetailEmptyView from './views/DetailEmpty.pzl';
import NotFoundView from './views/NotFound.pzl';
import AppShell from './layouts/AppShell.pzl';

// Every route reuses the same AppShell layout, so each top-level navigation is
// a "view swap inside a reused layout" (D28): only the view animates while the
// sidebar stays put.
//
// The three list sections use NESTED ROUTES (v1.3, D30) for the details panel:
// child paths are relative, `layout` stays top-level-only, and the section
// view renders its matched child at <Slot/>. `path: ''` is the index child —
// required for the bare section URL to match — and renders nothing (panel
// closed); `path: ':id'` slides in the shared Detail view. Swapping between
// siblings keeps the section view mounted (chain-prefix reuse), so only the
// panel level animates. The '*' catch-all renders NotFound.
export default [
  { path: '/', name: 'overview', view: OverviewView, layout: AppShell, meta: { title: 'Overview · Mission Control' } },
  {
    path: '/fleet', name: 'fleet', view: FleetView, layout: AppShell, meta: { title: 'Fleet · Mission Control' },
    children: [
      { path: '', name: 'fleet-index', view: DetailEmptyView },
      { path: ':id', name: 'fleet-detail', view: DetailView },
    ],
  },
  {
    path: '/missions', name: 'missions', view: MissionsView, layout: AppShell, meta: { title: 'Missions · Mission Control' },
    children: [
      { path: '', name: 'missions-index', view: DetailEmptyView },
      { path: ':id', name: 'missions-detail', view: DetailView },
    ],
  },
  {
    path: '/crew', name: 'crew', view: CrewView, layout: AppShell, meta: { title: 'Crew · Mission Control' },
    children: [
      { path: '', name: 'crew-index', view: DetailEmptyView },
      { path: ':id', name: 'crew-detail', view: DetailView },
    ],
  },
  { path: '*', name: 'not-found', view: NotFoundView, layout: AppShell, meta: { title: 'Not Found · Mission Control' } },
];
