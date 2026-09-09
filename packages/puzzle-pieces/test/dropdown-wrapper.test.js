import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

// Static guards for the dropdown-panel WRAPPER family and the navigation-menu
// family composed over it. There is nothing behavioural left to unit test here:
// hover intent, the hover bridge, the latch, one-open-at-a-time arbitration and
// the whole keyboard model live in @magic-spells/dropdown-panel and are tested
// there. What can still regress in this repo is the wiring — the manifests, the
// barrels, and the four rules a wrapper piece has to keep.

const PACKAGE = '@magic-spells/dropdown-panel';
const SPECIFIER = PACKAGE.replace('/', '\\/');

const readText = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const readJSON = async (path) => JSON.parse(await readText(path));

const BASE_FILES = [
	'DropdownPanel/DropdownPanel.pzl',
	'DropdownPanel/Trigger.pzl',
	'DropdownPanel/Panel.pzl',
	'DropdownPanel/index.js',
];
const NAV_FILES = [
	'NavigationMenu/NavigationMenu.pzl',
	'NavigationMenu/Item.pzl',
	'NavigationMenu/Trigger.pzl',
	'NavigationMenu/Content.pzl',
	'NavigationMenu/Link.pzl',
	'NavigationMenu/index.js',
];

const POPOVER_FILES = [
	'Popover/Popover.pzl',
	'Popover/Trigger.pzl',
	'Popover/Content.pzl',
	'Popover/index.js',
];
const HOVER_CARD_FILES = [
	'HoverCard/HoverCard.pzl',
	'HoverCard/Trigger.pzl',
	'HoverCard/Content.pzl',
	'HoverCard/index.js',
];
const MENUBAR_FILES = [
	'Menubar/Menubar.pzl',
	'Menubar/Menu.pzl',
	'Menubar/Trigger.pzl',
	'Menubar/Content.pzl',
	'Menubar/Item.pzl',
	'Menubar/Link.pzl',
	'Menubar/Separator.pzl',
	'Menubar/Label.pzl',
	'Menubar/Shortcut.pzl',
	'Menubar/index.js',
];
const POPCONFIRM_FILES = ['Popconfirm.pzl'];
const DROPDOWN_MENU_FILES = [
	'DropdownMenu/DropdownMenu.pzl',
	'DropdownMenu/Trigger.pzl',
	'DropdownMenu/Content.pzl',
	'DropdownMenu/Item.pzl',
	'DropdownMenu/Link.pzl',
	'DropdownMenu/Group.pzl',
	'DropdownMenu/Label.pzl',
	'DropdownMenu/Separator.pzl',
	'DropdownMenu/Shortcut.pzl',
	'DropdownMenu/Sub.pzl',
	'DropdownMenu/index.js',
];
const CONTEXT_MENU_FILES = [
	'ContextMenu/ContextMenu.pzl',
	'ContextMenu/Content.pzl',
	'ContextMenu/index.js',
];
const SPLIT_BUTTON_FILES = [
	'SplitButton/SplitButton.pzl',
	'SplitButton/Action.pzl',
	'SplitButton/Menu.pzl',
	'SplitButton/index.js',
];

const PIECES = [
	{
		piece: 'dropdown-panel',
		manifest: '../registry/ui/dropdown-panel/piece.json',
		files: BASE_FILES,
		registryDependencies: [],
		dependencies: [PACKAGE],
	},
	{
		piece: 'navigation-menu',
		manifest: '../registry/ui/navigation-menu/piece.json',
		files: NAV_FILES,
		// The npm package is inherited transitively through the base piece; the
		// add CLI accumulates dependencies across the resolved set.
		registryDependencies: ['dropdown-panel'],
		dependencies: [],
	},
	{
		piece: 'popover',
		manifest: '../registry/ui/popover/piece.json',
		files: POPOVER_FILES,
		registryDependencies: ['dropdown-panel'],
		dependencies: [],
	},
	{
		piece: 'hover-card',
		manifest: '../registry/ui/hover-card/piece.json',
		files: HOVER_CARD_FILES,
		registryDependencies: ['dropdown-panel'],
		dependencies: [],
	},
	{
		piece: 'popconfirm',
		manifest: '../registry/ui/popconfirm/piece.json',
		files: POPCONFIRM_FILES,
		registryDependencies: ['dropdown-panel'],
		dependencies: [],
	},
	{
		piece: 'menubar',
		manifest: '../registry/ui/menubar/piece.json',
		files: MENUBAR_FILES,
		registryDependencies: ['dropdown-panel'],
		dependencies: [],
	},
	{
		piece: 'dropdown-menu',
		manifest: '../registry/ui/dropdown-menu/piece.json',
		files: DROPDOWN_MENU_FILES,
		registryDependencies: ['dropdown-panel'],
		dependencies: [],
	},
	{
		// context-menu and split-button re-export dropdown-menu's ROW members
		// rather than forking nine identical files, so dropdown-menu — and
		// through it dropdown-panel — is the registry dependency.
		piece: 'context-menu',
		manifest: '../registry/ui/context-menu/piece.json',
		files: CONTEXT_MENU_FILES,
		registryDependencies: ['dropdown-menu'],
		dependencies: [],
	},
	{
		piece: 'split-button',
		manifest: '../registry/ui/split-button/piece.json',
		files: SPLIT_BUTTON_FILES,
		registryDependencies: ['dropdown-menu'],
		dependencies: [],
	},
];

// Every consumer file in the batch, paired with the piece it belongs to, for the
// rule sweeps below.
const CONSUMER_FILES = [
	...NAV_FILES.map((file) => ['navigation-menu', file]),
	...POPOVER_FILES.map((file) => ['popover', file]),
	...HOVER_CARD_FILES.map((file) => ['hover-card', file]),
	...POPCONFIRM_FILES.map((file) => ['popconfirm', file]),
	...MENUBAR_FILES.map((file) => ['menubar', file]),
	...DROPDOWN_MENU_FILES.map((file) => ['dropdown-menu', file]),
	...CONTEXT_MENU_FILES.map((file) => ['context-menu', file]),
	...SPLIT_BUTTON_FILES.map((file) => ['split-button', file]),
];

// The three menu families, whose whole point is that they reimplement NOTHING.
const MENU_FAMILY_FILES = [
	...DROPDOWN_MENU_FILES.map((file) => ['dropdown-menu', file]),
	...CONTEXT_MENU_FILES.map((file) => ['context-menu', file]),
	...SPLIT_BUTTON_FILES.map((file) => ['split-button', file]),
];

for (const entry of PIECES) {
	test(`the ${entry.piece} manifest declares its files and dependencies`, async () => {
		const piece = await readJSON(entry.manifest);
		assert.deepEqual(piece.files, entry.files);
		assert.deepEqual(piece.registryDependencies, entry.registryDependencies);
		assert.deepEqual(piece.dependencies, entry.dependencies);
		assert.equal(piece.targetDir, 'app/components/ui');
	});

	test(`registry.json mirrors the ${entry.piece} manifest`, async () => {
		const [piece, registry] = await Promise.all([
			readJSON(entry.manifest),
			readJSON('../registry/registry.json'),
		]);
		const row = registry.pieces.find((p) => p.name === entry.piece);

		assert.ok(row, `registry.json has no ${entry.piece} entry`);
		assert.equal(row.description, piece.description);
		assert.deepEqual(row.files, piece.files);
		assert.deepEqual(row.registryDependencies, piece.registryDependencies);
		assert.deepEqual(row.dependencies, piece.dependencies);
		assert.equal(row.targetDir, piece.targetDir);
	});

	test(`every ${entry.piece} manifest file exists on disk`, async () => {
		for (const file of entry.files) {
			await access(new URL(`../registry/ui/${entry.piece}/${file}`, import.meta.url));
		}
	});
}

test('registry.json pieces stay alphabetical', async () => {
	const registry = await readJSON('../registry/registry.json');
	const names = registry.pieces.map((p) => p.name);
	assert.deepEqual(names, [...names].sort());
});

test(`exactly one dynamic import of ${PACKAGE}, in the base root`, async () => {
	const sources = await Promise.all(
		[
			...BASE_FILES.map((file) => ['dropdown-panel', file]),
			...CONSUMER_FILES,
		].map(async ([piece, file]) => [
			`${piece}/${file}`,
			await readText(`../registry/ui/${piece}/${file}`),
		])
	);

	const dynamic = new RegExp(`import\\(\\s*['"]${SPECIFIER}['"]\\s*\\)`);
	const holders = sources.filter(([, source]) => dynamic.test(source)).map(([file]) => file);
	assert.deepEqual(
		holders,
		['dropdown-panel/DropdownPanel/DropdownPanel.pzl'],
		'the upgrade import belongs in the base root and nowhere else — it is module-cached, so a second one buys nothing and a member that imports is a member that cannot be dropped'
	);

	for (const [file, source] of sources) {
		// A top-level `import … from '<package>'` evaluates
		// `class extends HTMLElement` under Node and takes the whole prerender
		// pass down with a ReferenceError.
		assert.equal(
			new RegExp(`^\\s*import(?!\\s*\\()[^\\n]*['"]${SPECIFIER}['"]`, 'm').test(source),
			false,
			`${file} must not import ${PACKAGE} at module scope`
		);
		assert.equal(
			source.includes('customElements'),
			false,
			`${file} registers nothing itself`
		);
		assert.equal(/^<style[\s>]/m.test(source), false, `${file} has a <style> block`);
		assert.equal(
			/[^&]#[0-9a-fA-F]{3,8}\b/.test(source.replace(/#\{/g, '')),
			false,
			`${file} has a hex color — semantic tokens only`
		);
	}
});

test('no template binds the reflected `visible` attribute', async () => {
	for (const [piece, file] of [
		...BASE_FILES.map((f) => ['dropdown-panel', f]),
		...CONSUMER_FILES,
	]) {
		const source = await readText(`../registry/ui/${piece}/${file}`);
		const template = source.slice(0, source.indexOf('<script>'));
		assert.equal(
			/\bvisible\s*=\s*[{"']/.test(template),
			false,
			`${file} binds \`visible\` — the component REFLECTS that attribute as its own state, so a patcher binding fights it every render. Drive it through show()/hide() instead.`
		);
	}
});

test('the base root filters the bubbling dropdown-panel events by target', async () => {
	const source = await readText(
		'../registry/ui/dropdown-panel/DropdownPanel/DropdownPanel.pzl'
	);
	assert.match(
		source,
		/#mine\(event\)\s*\{\s*return event\.target === this\.element;/,
		'all four dropdown-panel:* events bubble — without a target check a nested submenu reports as its parent'
	);
	for (const call of ['this.#mine(event)']) {
		assert.ok(source.includes(call), `the guard must actually be called: ${call}`);
	}
});

test('both barrels export the D167 Object.assign family shape', async () => {
	const base = await readText('../registry/ui/dropdown-panel/DropdownPanel/index.js');
	assert.match(base, /export default Object\.assign\(DropdownPanel, \{ Trigger, Panel \}\)/);
	assert.match(base, /export \{ DropdownPanel, Trigger, Panel \}/);

	const nav = await readText('../registry/ui/navigation-menu/NavigationMenu/index.js');
	assert.match(
		nav,
		/export default Object\.assign\(NavigationMenu, \{ Item, Trigger, Content, Link \}\)/
	);
	assert.match(nav, /export \{ NavigationMenu, Item, Trigger, Content, Link \}/);
});

test('navigation-menu composes the base rather than re-exporting it', async () => {
	for (const file of ['Item.pzl', 'Trigger.pzl', 'Content.pzl']) {
		const source = await readText(`../registry/ui/navigation-menu/NavigationMenu/${file}`);
		assert.match(
			source,
			/import DropdownPanel from '\.\.\/DropdownPanel\/index\.js';/,
			`${file} must import the sibling base family — the copies land side by side under app/components/ui/`
		);
	}
});

test('the 0.7.0 consumers compose the base from the right relative depth', async () => {
	// A family member sits one directory down (app/components/ui/Popover/…), a
	// flat piece sits beside the base (app/components/ui/Popconfirm.pzl). Get the
	// depth wrong and the copy resolves nothing in a consumer app.
	const nested = [
		['popover', ['Popover/Popover.pzl', 'Popover/Trigger.pzl', 'Popover/Content.pzl']],
		['hover-card', ['HoverCard/HoverCard.pzl', 'HoverCard/Trigger.pzl', 'HoverCard/Content.pzl']],
		['menubar', ['Menubar/Menu.pzl', 'Menubar/Trigger.pzl', 'Menubar/Content.pzl']],
	];
	for (const [piece, files] of nested) {
		for (const file of files) {
			const source = await readText(`../registry/ui/${piece}/${file}`);
			assert.match(source, /import DropdownPanel from '\.\.\/DropdownPanel\/index\.js';/, file);
		}
	}
	const popconfirm = await readText('../registry/ui/popconfirm/Popconfirm.pzl');
	assert.match(popconfirm, /import DropdownPanel from '\.\/DropdownPanel\/index\.js';/);
});

test('the new family barrels export the D167 Object.assign shape', async () => {
	const popover = await readText('../registry/ui/popover/Popover/index.js');
	assert.match(popover, /export default Object\.assign\(Popover, \{ Trigger, Content \}\)/);

	const hoverCard = await readText('../registry/ui/hover-card/HoverCard/index.js');
	assert.match(hoverCard, /export default Object\.assign\(HoverCard, \{ Trigger, Content \}\)/);

	const menubar = await readText('../registry/ui/menubar/Menubar/index.js');
	assert.match(menubar, /export default Object\.assign\(Menubar, \{/);
	for (const member of ['Menu', 'Trigger', 'Content', 'Item', 'Link', 'Separator', 'Label', 'Shortcut']) {
		assert.ok(menubar.includes(`import ${member} from './${member}.pzl';`), member);
	}
});

test('menubar claims no ARIA menu roles', async () => {
	// Upstream is a DISCLOSURE and provides no bar-level roving, so role="menubar"
	// / role="menuitem" would promise a keyboard model that is not there. The one
	// sanctioned role in the family is separator.
	for (const file of MENUBAR_FILES.filter((f) => f.endsWith('.pzl'))) {
		const source = await readText(`../registry/ui/menubar/${file}`);
		// Template only — the header comments explain the decision in prose.
		const template = source.slice(0, source.indexOf('<script>'));
		for (const role of ['menubar', 'menuitem', 'menu']) {
			assert.equal(
				template.includes(`role="${role}"`),
				false,
				`${file} authors an ARIA menu role`
			);
		}
	}
});

test('the menu families reimplement none of what menu mode provides', async () => {
	// The 0.7.0 rewrite deleted ~900 lines of ported machinery across these three
	// pieces: roving tabindex, an outside-pointerdown listener, the Arrow/Home/End
	// switch, the Space-on-a-link branch, the pointer clamp, and every
	// hand-authored menu role. This is the cheapest net against any of it coming
	// back — the component owns all of it, and a piece that duplicates it fights it.
	// Authoring these is only ever visible in the TEMPLATE; the header comments
	// explain in prose why the family does not write them.
	const BANNED_MARKUP = ['tabindex=', 'role="menu', 'aria-expanded', 'aria-haspopup'];
	// These would be ported machinery wherever they appeared.
	const BANNED_ANYWHERE = ['document.addEventListener', '_pendingFocus'];
	for (const [piece, file] of MENU_FAMILY_FILES) {
		const source = await readText(`../registry/ui/${piece}/${file}`);
		const scriptAt = source.indexOf('<script>');
		const template = scriptAt === -1 ? '' : source.slice(0, scriptAt);
		for (const needle of BANNED_MARKUP) {
			assert.equal(
				template.includes(needle),
				false,
				`${piece}/${file} authors \`${needle}\` — menu mode owns that, see DropdownMenu.pzl`
			);
		}
		for (const needle of BANNED_ANYWHERE) {
			assert.equal(
				source.includes(needle),
				false,
				`${piece}/${file} contains \`${needle}\` — menu mode owns that, see DropdownMenu.pzl`
			);
		}
	}
});

test('the menu families compose the base from the right relative depth', async () => {
	// Every copy lands side by side under app/components/ui/, so a member one
	// directory down reaches its siblings with '../<Family>/index.js'.
	const base = [
		['dropdown-menu', ['DropdownMenu/DropdownMenu.pzl', 'DropdownMenu/Trigger.pzl', 'DropdownMenu/Content.pzl']],
		['context-menu', ['ContextMenu/ContextMenu.pzl']],
	];
	for (const [piece, files] of base) {
		for (const file of files) {
			const source = await readText(`../registry/ui/${piece}/${file}`);
			assert.match(source, /import DropdownPanel from '\.\.\/DropdownPanel\/index\.js';/, file);
		}
	}
	for (const [piece, file] of [
		['context-menu', 'ContextMenu/Content.pzl'],
		['split-button', 'SplitButton/Menu.pzl'],
	]) {
		const source = await readText(`../registry/ui/${piece}/${file}`);
		assert.match(source, /from '\.\.\/DropdownMenu\/index\.js';/, file);
	}
	// Sub imports the root FILE, not the barrel — the barrel imports Sub, and a
	// cycle through it would leave one of them undefined at evaluation time.
	const sub = await readText('../registry/ui/dropdown-menu/DropdownMenu/Sub.pzl');
	assert.match(sub, /import DropdownMenu from '\.\/DropdownMenu\.pzl';/);
});

test('the menu family barrels export the D167 Object.assign shape', async () => {
	const dropdown = await readText('../registry/ui/dropdown-menu/DropdownMenu/index.js');
	assert.match(dropdown, /export default Object\.assign\(DropdownMenu, \{/);
	for (const member of [
		'Trigger',
		'Content',
		'Item',
		'Link',
		'Group',
		'Label',
		'Separator',
		'Shortcut',
		'Sub',
	]) {
		assert.ok(dropdown.includes(`import ${member} from './${member}.pzl';`), member);
	}

	// The row members are RE-EXPORTED, not duplicated: a context-menu row IS a
	// dropdown-menu row, and dropdown-menu is copied into the consumer app anyway
	// as the registry dependency, so one edit serves both menus.
	for (const [piece, dir, own] of [
		['context-menu', 'ContextMenu', ['Content']],
		['split-button', 'SplitButton', ['Action', 'Menu']],
	]) {
		const barrel = await readText(`../registry/ui/${piece}/${dir}/index.js`);
		assert.match(barrel, /from '\.\.\/DropdownMenu\/index\.js';/, `${piece} re-exports the rows`);
		for (const member of own) {
			assert.ok(barrel.includes(`import ${member} from './${member}.pzl';`), `${piece}/${member}`);
		}
		for (const member of ['Item', 'Link', 'Separator']) {
			assert.equal(
				barrel.includes(`from './${member}.pzl'`),
				false,
				`${piece} must not fork ${member}`
			);
		}
	}
});

test('the base forwards select without a target filter, and sub silences it', async () => {
	// select is the one event that is NOT #mine-filtered: a submenu choice closes
	// the whole chain and returns focus to the ROOT trigger, so the root is what
	// owes the parent a report. `sub` is what stops the nested roots reporting too.
	const source = await readText(
		'../registry/ui/dropdown-panel/DropdownPanel/DropdownPanel.pzl'
	);
	assert.match(source, /#onSelect = \(event\) => \{\s*\n\s*if \(this\.props\.sub\) return;/);
	assert.equal(
		/#onSelect[\s\S]{0,200}#mine\(event\)/.test(source),
		false,
		'select must NOT be target-filtered — the root reports a submenu\'s select too'
	);
	const sub = await readText('../registry/ui/dropdown-menu/DropdownMenu/Sub.pzl');
	assert.match(sub, /sub=\{ true \}/, 'Sub must pass `sub` or the chain reports twice');
});
