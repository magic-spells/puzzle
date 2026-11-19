import Post from './post.js';
import Comment from './comment.js';

// the registry: each key is the type string every store call takes
export default {
  post: Post,
  comment: Comment,
};
