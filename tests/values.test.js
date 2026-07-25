import { describe, it, expect } from 'vitest';
import { moduleLabel, moduleTitle, viewKind } from '../panel/app/values.js';

/*
 * Unit coverage for the tree-row projection helpers.
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
