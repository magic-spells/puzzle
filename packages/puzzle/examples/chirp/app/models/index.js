import User from './user.js';
import Post from './post.js';
import Notification from './notification.js';

// Model registry handed to PuzzleApp (SPEC §7). Keys are the type names used
// everywhere in store calls: findOne('user', …), findMany('post', …), etc.
export const models = {
  user: User,
  post: Post,
  notification: Notification,
};

export default models;
