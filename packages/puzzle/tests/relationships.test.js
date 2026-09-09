import { describe, it, expect, vi } from 'vitest';
import { Store } from '../client-runtime/datastore/store.js';
import { PuzzleModel, Puzzle } from '../client-runtime/model.js';

// Canonical blog-shaped fixtures (constellation/doc/DOC-SPEC.md §21, D49):
// a Post belongsTo a User (author) and hasMany Comments; a Comment carries the
// postId FK. Each `describe` builds a FRESH set of classes so getter install
// (which mutates the prototype) can't bleed between suites.
function makeClasses() {
	class User extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			name: Puzzle.string().required(),
		};
	}
	class Comment extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			postId: Puzzle.string(),
			text: Puzzle.string().required(),
		};
	}
	class Post extends PuzzleModel {
		static schema = {
			id: Puzzle.string().primary(),
			title: Puzzle.string().required(),
			authorId: Puzzle.string(),
			author: Puzzle.belongsTo('user'), // infers authorId
			comments: Puzzle.hasMany('comment'), // infers postId from owner type 'post'
		};
	}
	return { User, Comment, Post };
}

const makeStore = (classes = makeClasses(), options) =>
	new Store({ user: classes.User, comment: classes.Comment, post: classes.Post }, options);

describe('Relationships — schema separation (SPEC §21)', () => {
	it('normalizedSchema excludes relationship entries (fields only)', () => {
		const { Post } = makeClasses();
		const schema = Post.normalizedSchema();
		expect(Object.keys(schema)).toEqual(['id', 'title', 'authorId']);
		expect(schema.author).toBeUndefined();
		expect(schema.comments).toBeUndefined();
	});

	it('relationshipDefs exposes only the relationship descriptors', () => {
		const { Post } = makeClasses();
		expect(Post.relationshipDefs()).toEqual({
			author: { kind: 'belongsTo', type: 'user' },
			comments: { kind: 'hasMany', type: 'comment' },
		});
	});

	it('belongsTo/hasMany builders are a distinct kind, not FieldBuilders', () => {
		const rel = Puzzle.belongsTo('user');
		expect(rel.def).toEqual({ kind: 'belongsTo', type: 'user' });
		// no chainable rule modifiers — a relationship is not a field
		expect(rel.required).toBeUndefined();
		expect(rel.default).toBeUndefined();
		expect(Puzzle.hasMany('comment', { key: 'ownerId' }).def).toEqual({
			kind: 'hasMany',
			type: 'comment',
			key: 'ownerId',
		});
	});

	it('applyDefaults and primaryKey are unaffected by relationship entries', () => {
		const { Post } = makeClasses();
		const withDefaults = Post.applyDefaults({ title: 'x' });
		expect('author' in withDefaults).toBe(false);
		expect('comments' in withDefaults).toBe(false);
		expect(Post.primaryKey()).toBe('id');
	});

	it('§20 validation never fires on relationship entries', () => {
		const { Post } = makeClasses();
		// A record valid on its declared fields validates clean — no error keyed
		// to 'author'/'comments' even though they are declared in the schema.
		const result = Post.validate({ id: 'p1', title: 'Hello', authorId: 'u1' });
		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);

		// And an invalid field still reports — only relationships are skipped.
		const bad = Post.validate({ id: 'p1' }); // title required
		expect(bad.valid).toBe(false);
		expect(bad.errors.map((e) => e.field)).toEqual(['title']);
	});
});

describe('Relationships — belongsTo resolution (SPEC §21)', () => {
	it('resolves the related record via the inferred FK', () => {
		const store = makeStore();
		const user = store.createRecord('user', { id: 'u1', name: 'Ada' });
		const post = store.createRecord('post', { id: 'p1', title: 'Hi', authorId: 'u1' });
		expect(post.author).toBe(user);
	});

	it('returns null on a miss (FK points at nothing)', () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: 'p1', title: 'Hi', authorId: 'ghost' });
		expect(post.author).toBeNull();
	});

	it('returns null (without querying) when the FK is null/undefined', () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: 'p1', title: 'Hi' });
		expect(post.authorId).toBeUndefined();
		expect(post.author).toBeNull();
		// no junk 'user undefined' subscription key was created
		expect(store.subscribersByKey.has('user undefined')).toBe(false);
	});

	it('honors an explicit { key } override', () => {
		class User extends PuzzleModel {
			static schema = { id: Puzzle.string().primary() };
		}
		class Post extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				writtenBy: Puzzle.string(),
				author: Puzzle.belongsTo('user', { key: 'writtenBy' }),
			};
		}
		const store = new Store({ user: User, post: Post });
		const user = store.createRecord('user', { id: 'u1' });
		const post = store.createRecord('post', { id: 'p1', writtenBy: 'u1' });
		expect(post.author).toBe(user);
	});
});

describe('Relationships — hasMany resolution (SPEC §21)', () => {
	it('resolves matching records in store insertion order', () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: 'p1', title: 'Hi' });
		const c1 = store.createRecord('comment', { id: 'c1', postId: 'p1', text: 'first' });
		const c2 = store.createRecord('comment', { id: 'c2', postId: 'p1', text: 'second' });
		store.createRecord('comment', { id: 'c3', postId: 'other', text: 'elsewhere' });

		expect(post.comments).toEqual([c1, c2]); // insertion order, filtered
	});

	it('returns a fresh array each read', () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: 'p1', title: 'Hi' });
		expect(post.comments).not.toBe(post.comments);
	});

	it('returns [] when there are no matches', () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: 'p1', title: 'Hi' });
		expect(post.comments).toEqual([]);
	});

	it('infers the FK from the OWNER registry type (postId)', () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: 'p1', title: 'Hi' });
		store.createRecord('comment', { id: 'c1', postId: 'p1', text: 'x' });
		expect(post.comments).toHaveLength(1);
	});

	it('honors an explicit { key } override', () => {
		class Comment extends PuzzleModel {
			static schema = { id: Puzzle.string().primary(), owner: Puzzle.string() };
		}
		class Post extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				comments: Puzzle.hasMany('comment', { key: 'owner' }),
			};
		}
		const store = new Store({ comment: Comment, post: Post });
		const post = store.createRecord('post', { id: 'p1' });
		const c1 = store.createRecord('comment', { id: 'c1', owner: 'p1' });
		expect(post.comments).toEqual([c1]);
	});
});

describe('Relationships — store-less records', () => {
	it('belongsTo → null and hasMany → [] with no store attached', () => {
		const classes = makeClasses();
		// Registering the classes installs the getters on their prototypes...
		makeStore(classes);
		// ...but a record constructed directly (not via createRecord) has no store.
		const detached = new classes.Post({ id: 'p1', title: 'Hi', authorId: 'u1' });
		expect(detached._store).toBeNull();
		expect(detached.author).toBeNull();
		expect(detached.comments).toEqual([]);
	});
});

describe('Relationships — reactivity rides the subscription machinery (SPEC §21)', () => {
	it('a belongsTo traversal in a tracked eval re-runs the subscriber on target change', () => {
		const store = makeStore();
		store.createRecord('user', { id: 'u1', name: 'Ada' });
		const post = store.createRecord('post', { id: 'p1', title: 'Hi', authorId: 'u1' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => post.author); // subscribes 'user u1'

		store.findOne('user', 'u1').update({ name: 'Ada Lovelace' });
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);
	});

	it('a hasMany traversal re-runs on create/change/destroy of the target collection', () => {
		const store = makeStore();
		const post = store.createRecord('post', { id: 'p1', title: 'Hi' });
		store.flush();

		const component = { onStoreChange: vi.fn() };
		store.withTracking(component, () => post.comments); // subscribes 'comment'

		const c1 = store.createRecord('comment', { id: 'c1', postId: 'p1', text: 'x' });
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(1);

		store.withTracking(component, () => post.comments);
		c1.update({ text: 'edited' });
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(2);

		store.withTracking(component, () => post.comments);
		c1.destroy();
		store.flush();
		expect(component.onStoreChange).toHaveBeenCalledTimes(3);
	});
});

describe('Relationships — reserved property name (SPEC §21)', () => {
	it('assigning to a relationship warns ONCE and is ignored', () => {
		const store = makeStore();
		const user = store.createRecord('user', { id: 'u1', name: 'Ada' });
		const post = store.createRecord('post', { id: 'p1', title: 'Hi', authorId: 'u1' });

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		post.author = { id: 'nope' };
		post.author = { id: 'still-nope' };
		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn.mock.calls[0][0]).toMatch(
			/"author" is a relationship on model "post".*set "authorId" instead/
		);
		// assignment ignored — the getter still resolves through the FK
		expect(post.author).toBe(user);
		warn.mockRestore();
	});

	it('Object.assign carrying an embedded relationship payload does not throw (server case)', () => {
		const store = makeStore();
		store.createRecord('user', { id: 'u1', name: 'Ada' });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

		// An embedded payload: authorId sets, the embedded `author` object is dropped.
		let post;
		expect(() => {
			post = store.createRecord('post', { id: 'p1', title: 'Hi', authorId: 'u1', author: { id: 'x' } });
		}).not.toThrow();
		expect(post.authorId).toBe('u1');
		expect(post.author).toBe(store.findOne('user', 'u1'));
		warn.mockRestore();
	});
});

describe('Relationships — serialization & cycles (SPEC §21)', () => {
	it('toJSON serializes the FK, never the resolved relationship', () => {
		const store = makeStore();
		store.createRecord('user', { id: 'u1', name: 'Ada' });
		const post = store.createRecord('post', { id: 'p1', title: 'Hi', authorId: 'u1' });
		store.createRecord('comment', { id: 'c1', postId: 'p1', text: 'x' });

		const json = post.toJSON();
		expect(json).toEqual({ id: 'p1', title: 'Hi', authorId: 'u1' });
		expect('author' in json).toBe(false);
		expect('comments' in json).toBe(false);
		// full JSON round-trip is safe despite the lazy cycle post.author.posts...
		expect(() => JSON.stringify(post)).not.toThrow();
	});

	it('cyclic traversal is safe (post.author, and back)', () => {
		// Add an inverse hasMany on user to exercise the cycle.
		class User extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				posts: Puzzle.hasMany('post', { key: 'authorId' }),
			};
		}
		class Post extends PuzzleModel {
			static schema = {
				id: Puzzle.string().primary(),
				authorId: Puzzle.string(),
				author: Puzzle.belongsTo('user'),
			};
		}
		const store = new Store({ user: User, post: Post });
		const user = store.createRecord('user', { id: 'u1' });
		const post = store.createRecord('post', { id: 'p1', authorId: 'u1' });

		expect(post.author).toBe(user);
		expect(user.posts).toEqual([post]);
		expect(post.author.posts[0]).toBe(post); // cycle terminates (lazy)
	});
});
