import HomeView from './views/Home.pzl';
import PostsView from './views/Posts.pzl';
import PostDetailView from './views/PostDetail.pzl';
import AboutView from './views/About.pzl';
import SettingsView from './views/settings/Settings.pzl';
import SettingsGeneralView from './views/settings/General.pzl';
import SettingsProfileView from './views/settings/Profile.pzl';
import SettingsNotificationsView from './views/settings/Notifications.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

export default [
  {
    path: '/',
    name: 'home',
    view: HomeView,
    layout: DefaultLayout,
    meta: {
      title: 'Puzzle Press'
    }
  },
  {
    path: '/posts',
    name: 'posts',
    view: PostsView,
    layout: DefaultLayout,
    meta: {
      title: 'All Posts · Puzzle Press'
    }
  },
  {
    path: '/posts/:id',
    name: 'post',
    view: PostDetailView,
    layout: DefaultLayout,
    meta: {
      title: 'Post · Puzzle Press'
    }
  },
  {
    path: '/about',
    name: 'about',
    view: AboutView,
    layout: DefaultLayout,
    meta: {
      title: 'About · Puzzle Press'
    }
  },
  // Nested routes (v1.3, D30): the Settings shell renders its matched child
  // pane at its <Slot/>. Child paths are RELATIVE; `path: ''` is the index
  // child that fills the slot at the bare /settings URL.
  {
    path: '/settings',
    name: 'settings',
    view: SettingsView,
    layout: DefaultLayout,
    meta: {
      title: 'Settings · Puzzle Press'
    },
    children: [
      { path: '', name: 'settings-general', view: SettingsGeneralView },
      { path: 'profile', name: 'settings-profile', view: SettingsProfileView, meta: { title: 'Profile Settings · Puzzle Press' } },
      { path: 'notifications', name: 'settings-notifications', view: SettingsNotificationsView }
    ]
  },
  {
    path: '*',
    name: 'not-found',
    view: NotFoundView,
    layout: DefaultLayout,
    meta: {
      title: 'Not Found · Puzzle Press'
    }
  }
];
