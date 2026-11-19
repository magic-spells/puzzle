import PostListView from './views/PostList.pzl';
import PostDetailView from './views/PostDetail.pzl';
import CommentsView from './views/Comments.pzl';
import NotFoundView from './views/NotFound.pzl';
import DefaultLayout from './layouts/Default.pzl';

// three screens, one per D193 feature:
// - /           page links: the page number lives in ?page=
// - /posts/:id  publish with pending and error state, then invalidate
// - /comments   cursor "load more"
export default [
  { path: '/', name: 'posts', view: PostListView, layout: DefaultLayout, meta: { title: 'Posts' } },
  { path: '/posts/:id', name: 'post', view: PostDetailView, layout: DefaultLayout, meta: { title: 'Post' } },
  { path: '/comments', name: 'comments', view: CommentsView, layout: DefaultLayout, meta: { title: 'Comments' } },
  { path: '*', name: 'not-found', view: NotFoundView, layout: DefaultLayout, meta: { title: 'Not found' } },
];
