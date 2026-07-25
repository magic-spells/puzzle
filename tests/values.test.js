import { describe, it, expect } from 'vitest';
import {
	appendHistory,
	diffRecord,
	moduleLabel,
	moduleTitle,
	subscriptionKind,
	subscriptionParts,
	viewKind,
} from '../panel/app/values.js';

/*
 * Unit coverage for the panel's pure projection helpers.
 *
 * These import the SOURCE module, not the compiled bundle — values.js has no
 * imports of its own, so it loads standalone. The panel-app suite proves the
 * rules reach the DOM; this suite pins the rules themselves, including the cases
 * the fixture transcript never produces.
 */

describe('viewKind', () => {
	it('reads the kind off the module path directories', () => {
		expect(viewKind('layouts/Shell.pzl')).toBe('layout');
		expect(viewKind('views/Home.pzl')).toBe('view');
		expect(viewKind('components/Row.pzl')).toBe('component');
	});

	it('finds the segment at any depth', () => {
		expect(viewKind('app/layouts/admin/Shell.pzl')).toBe('layout');
		expect(viewKind('components/ui/Badge.pzl')).toBe('component');
	});

	it('falls back to a plain view', () => {
		expect(viewKind('widgets/Thing.pzl')).toBe('view');
		expect(viewKind('Thing.pzl')).toBe('view');
		// A hand-written class carries no module stamp at all.
		expect(viewKind(null)).toBe('view');
		expect(viewKind(undefined)).toBe('view');
		expect(viewKind('')).toBe('view');
	});

	it('only considers DIRECTORY segments, never the filename', () => {
		// A view whose FILE is named components.pzl is still a view.
		expect(viewKind('views/components.pzl')).toBe('view');
		expect(viewKind('views/layouts.pzl')).toBe('view');
	});

	it('prefers layout when a path could read as both', () => {
		expect(viewKind('layouts/components/Odd.pzl')).toBe('layout');
	});
});

describe('moduleLabel', () => {
	it('drops the path entirely when the basename just repeats the name', () => {
		// The redundancy this whole rule exists for: "MainLayout MainLayout.pzl".
		expect(moduleLabel('MainLayout', 'layouts/MainLayout.pzl')).toBe('');
		expect(moduleLabel('Home', 'views/Home.pzl')).toBe('');
		expect(moduleLabel('Badge', 'components/ui/Badge.pzl')).toBe('');
	});

	it('shows the basename only when it adds information', () => {
		expect(moduleLabel('FixtureLayout', 'layouts/Fixture.pzl')).toBe('Fixture.pzl');
		expect(moduleLabel('TodoRow', 'components/Row.pzl')).toBe('Row.pzl');
	});

	it('never shows a directory, however deep', () => {
		expect(moduleLabel('Thing', 'app/components/deeply/nested/Other.pzl')).toBe('Other.pzl');
	});

	it('is empty when there is no module', () => {
		expect(moduleLabel('Anon', null)).toBe('');
		expect(moduleLabel('Anon', undefined)).toBe('');
		expect(moduleLabel('Anon', '')).toBe('');
	});

	it('is case- and extension-exact', () => {
		// Only an exact `<Name>.pzl` match is redundant.
		expect(moduleLabel('Home', 'views/home.pzl')).toBe('home.pzl');
		expect(moduleLabel('Home', 'views/HomePage.pzl')).toBe('HomePage.pzl');
	});
});

describe('moduleTitle', () => {
	it('always carries the FULL path, even when the row hides it', () => {
		expect(moduleTitle('MainLayout', 'layouts/MainLayout.pzl')).toBe('layouts/MainLayout.pzl');
		expect(moduleTitle('FixtureLayout', 'layouts/Fixture.pzl')).toBe('layouts/Fixture.pzl');
	});

	it('falls back to the name when there is no module', () => {
		expect(moduleTitle('Anon', null)).toBe('Anon');
		expect(moduleTitle('Anon', '')).toBe('Anon');
	});
});

describe('subscriptionKind / subscriptionParts', () => {
	/*
	 * The separator is a SPACE, not a colon. The runtime builds record keys as
	 * `type + REC_SEP + id` with REC_SEP = ' ' (client-runtime/datastore/store.js,
	 * "never appears in a type name"), and the bridge forwards keys verbatim — so
	 * a live key is 'todo t2'. These tests exist to keep that pinned: a colon
	 * form would silently file every record subscription under Collections.
	 */
	it('treats a key with no space as a collection key', () => {
		expect(subscriptionKind('todo')).toBe('collection');
		expect(subscriptionKind('user')).toBe('collection');
		expect(subscriptionParts('todo')).toEqual({ type: 'todo', id: null, kind: 'collection' });
	});

	it('treats `type id` as a record key, splitting on the FIRST space', () => {
		expect(subscriptionKind('todo t2')).toBe('record');
		expect(subscriptionParts('todo t2')).toEqual({ type: 'todo', id: 't2', kind: 'record' });
	});

	it('does not treat a colon as a separator — that is not the runtime scheme', () => {
		// 'todo:t2' has no space, so it is a (weirdly named) COLLECTION key.
		expect(subscriptionKind('todo:t2')).toBe('collection');
		expect(subscriptionParts('todo:t2').type).toBe('todo:t2');
	});

	it('keeps a pk that contains spaces intact', () => {
		// Split once: the type cannot contain a space, but an id can.
		expect(subscriptionParts('todo my id 7')).toEqual({
			type: 'todo',
			id: 'my id 7',
			kind: 'record',
		});
		expect(subscriptionParts('todo a:b')).toEqual({ type: 'todo', id: 'a:b', kind: 'record' });
	});
});

describe('diffRecord', () => {
	it('reports changed fields with their old and new values', () => {
		const changes = diffRecord(
			{ id: 't1', text: 'old', priority: 1 },
			{ id: 't1', text: 'new', priority: 2 }
		);
		expect(changes).toEqual([
			{ field: 'text', from: 'old', to: 'new' },
			{ field: 'priority', from: 1, to: 2 },
		]);
	});

	it('reports added and removed fields', () => {
		expect(diffRecord({ id: 't1' }, { id: 't1', note: 'hi' })).toEqual([
			{ field: 'note', from: undefined, to: 'hi' },
		]);
		expect(diffRecord({ id: 't1', note: 'hi' }, { id: 't1' })).toEqual([
			{ field: 'note', from: 'hi', to: undefined },
		]);
	});

	it('returns nothing when the snapshot is unchanged', () => {
		const row = { id: 't1', text: 'same', completed: false, priority: 3 };
		expect(diffRecord(row, { ...row })).toEqual([]);
	});

	it('ignores _synced, which the bridge synthesizes per snapshot', () => {
		expect(diffRecord({ id: 't1', _synced: false }, { id: 't1', _synced: true })).toEqual([]);
	});

	it('compares structures by value, not identity', () => {
		// Snapshots are re-serialized every flush, so a fresh array with the same
		// contents must not read as a change.
		expect(diffRecord({ tags: ['a', 'b'] }, { tags: ['a', 'b'] })).toEqual([]);
		expect(diffRecord({ tags: ['a'] }, { tags: ['a', 'b'] })).toHaveLength(1);
	});

	it('treats NaN as unchanged and distinguishes false from 0', () => {
		expect(diffRecord({ n: NaN }, { n: NaN })).toEqual([]);
		expect(diffRecord({ n: 0 }, { n: false })).toEqual([{ field: 'n', from: 0, to: false }]);
	});

	it('tolerates a missing side', () => {
		expect(diffRecord(null, { id: 't1' })).toEqual([{ field: 'id', from: undefined, to: 't1' }]);
		expect(diffRecord({ id: 't1' }, null)).toEqual([{ field: 'id', from: 't1', to: undefined }]);
		expect(diffRecord(null, null)).toEqual([]);
	});

	it('keeps previous-field order, then appends new keys', () => {
		const changes = diffRecord({ b: 1, a: 1 }, { b: 2, a: 2, c: 3 });
		expect(changes.map((c) => c.field)).toEqual(['b', 'a', 'c']);
	});
});

describe('appendHistory', () => {
	it('prepends newest-first and stamps each entry', () => {
		const first = appendHistory([], [{ field: 'text', from: 'a', to: 'b' }], 100);
		const second = appendHistory(first, [{ field: 'text', from: 'b', to: 'c' }], 200);

		expect(second).toHaveLength(2);
		expect(second[0]).toEqual({ field: 'text', from: 'b', to: 'c', at: 200 });
		expect(second[1]).toEqual({ field: 'text', from: 'a', to: 'b', at: 100 });
	});

	it('returns the SAME array when there is nothing to add', () => {
		const history = [{ field: 'x', from: 1, to: 2, at: 1 }];
		expect(appendHistory(history, [], 5)).toBe(history);
		expect(appendHistory(history, null, 5)).toBe(history);
	});

	it('trims the oldest past the cap', () => {
		let history = [];
		for (let i = 0; i < 35; i++) {
			history = appendHistory(history, [{ field: 'n', from: i, to: i + 1 }], i, 30);
		}
		expect(history).toHaveLength(30);
		expect(history[0].from).toBe(34); // newest kept
		expect(history[29].from).toBe(5); // oldest five dropped
	});

	it('keeps every change from one flush, in order', () => {
		const history = appendHistory(
			[],
			[
				{ field: 'text', from: 'a', to: 'b' },
				{ field: 'priority', from: 1, to: 2 },
			],
			50
		);
		expect(history.map((h) => h.field)).toEqual(['text', 'priority']);
	});
});
