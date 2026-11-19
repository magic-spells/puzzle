// fixture data for `puzzle dev --fixtures` (D98). inert without the flag.
//
// the mock adapter is an in-memory rest server behind each model's endpoint.
// a collection GET carrying page, limit or after answers one page as
// { records, meta: { page, limit, total, nextPage, nextCursor } } (D193), so
// this example paginates with no handler of its own.

/**
 * build n fake posts with ids 1..n. every third one starts published.
 * @param {number} n
 * @returns {Record<string, any>[]}
 */
function makePosts(n) {
  const topics = ['stores', 'routers', 'templates', 'adapters', 'skeletons', 'transitions', 'fixtures'];
  const authors = ['Ada', 'Grace', 'Linus', 'Margaret', 'Ken'];
  const posts = [];
  for (let id = 1; id <= n; id++) {
    const topic = topics[id % topics.length];
    posts.push({
      id,
      title: `Notes on ${topic}, part ${Math.ceil(id / topics.length)}`,
      body: `Post ${id} is about ${topic}. It exists so the list has enough rows to page through.`,
      author: authors[id % authors.length],
      published: id % 3 === 0,
    });
  }
  return posts;
}

/**
 * build n fake comments with ids 1..n, spread over the first few posts.
 * @param {number} n
 * @returns {Record<string, any>[]}
 */
function makeComments(n) {
  const authors = ['Sam', 'Riley', 'Jo', 'Alex'];
  const comments = [];
  for (let id = 1; id <= n; id++) {
    comments.push({
      id,
      postId: (id % 6) + 1,
      author: authors[id % authors.length],
      body: `Comment number ${id}. Load more to walk the cursor.`,
    });
  }
  return comments;
}

export default {
  seed: 7,

  mock: {
    post: {
      data: makePosts(47),
      // a little latency so the old page visibly stays on screen until the
      // new one lands, and the publish button shows its pending state
      latency: [200, 500],
      // the mock refuses to publish every fifth post, so the error state is
      // easy to see: open post 5, 10, 15… and press Publish.
      handler({ method, path, body }) {
        const id = Number(path.slice(1));
        if (method === 'PUT' && body?.published && id % 5 === 0) {
          return { status: 500, body: { error: 'The server refused to publish this post.' } };
        }
        // anything else falls through to the default crud (and pagination)
        return null;
      },
    },
    comment: {
      data: makeComments(23),
      latency: [200, 500],
    },
  },
};
