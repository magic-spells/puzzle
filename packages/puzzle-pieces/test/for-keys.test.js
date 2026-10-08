import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every item-form {#for} in a piece needs a row key. Without `key={ … }` on the
// row root the runtime keys each row by its `.id` (ViewNode.keyOf), and a row
// with no `.id` drops the whole list to positional diffing and logs
// `[puzzle] {#for} item (…) has no usable key` in the consumer's app. That is
// how 0.8.0's Sidebar and RadioGroup warned on every page.
//
// Static check: each loop's row root carries `key=`, or the loop is listed
// below as one whose rows are built with an `id` (option rows, cells, chips and
// toasts carry one for aria-activedescendant or close-by-id anyway). The list
// is per FILE, with how many keyless loops of that name the file may hold, so a
// second keyless `chip in chips` in TagsInput still fails. A new keyless loop
// fails here: add a key, or list it once its rows really do carry an `id`.

const ID_KEYED = {
	'combobox/Combobox.pzl': { 'row in rows': 1 },
	'command/Command.pzl': { 'row in rows': 1 },
	'emoji-picker/EmojiPicker.pzl': { 'row in rows': 1 },
	'emoji-picker-simple/EmojiPickerSimple.pzl': { 'cell in cells': 1, 'tab in tabs': 1 },
	'input-otp/InputOtp.pzl': { 'item in items': 1 },
	'multi-select/MultiSelect.pzl': { 'chip in chips': 1, 'row in rows': 1 },
	// The visible chips and the hidden form inputs both loop over `chips`.
	'tags-input/TagsInput.pzl': { 'chip in chips': 2 },
	'time-picker/TimePicker.pzl': { 'opt in col.options': 1 },
	'toast/Toaster.pzl': { 'item in items': 1 },
};

const UI = fileURLToPath(new URL('../registry/ui/', import.meta.url));

async function pzlFiles(dir) {
	const out = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...(await pzlFiles(path)));
		else if (entry.name.endsWith('.pzl')) out.push(path);
	}
	return out;
}

// The row root's opening tag, from `<` to its closing `>`, skipping any `>`
// inside a `{ … }` expression or a quoted attribute value.
function openingTag(src) {
	let depth = 0;
	let quote = null;
	for (let i = 0; i < src.length; i++) {
		const c = src[i];
		if (quote) {
			if (c === quote) quote = null;
		} else if (c === '"' || c === "'") quote = c;
		else if (c === '{') depth++;
		else if (c === '}') depth--;
		else if (c === '>' && depth === 0) return src.slice(0, i + 1);
	}
	return src;
}

/**
 * The item-form loops in a .pzl source whose row root carries no `key`, by
 * header with any counter dropped (`f in files, i` → `f in files`). Only the
 * template is read, with HTML comments removed: a loop in a comment is not a
 * loop, and a comment before the row root is not the root.
 * @param {string} source
 * @returns {string[]}
 */
function keylessLoops(source) {
	const end = source.indexOf('</puzzle-view>');
	const template = (end === -1 ? source : source.slice(0, end)).replace(/<!--[\s\S]*?-->/g, '');
	const out = [];
	for (const m of template.matchAll(/\{#for\s+([^}]*)\}\s*/g)) {
		const header = m[1].trim();
		if (header.includes('...')) continue; // range rows are keyed by value
		const loop = header.replace(/,\s*\w+$/, '');
		const body = template.slice(m.index + m[0].length);
		if (!body.startsWith('<')) out.push(`${loop} (row root is not an element)`);
		else if (!/\skey=/.test(openingTag(body))) out.push(loop);
	}
	return out;
}

test('keylessLoops reads past comments and flags only keyless roots', () => {
	const source = `<puzzle-view>
  <ul>
    {#for a in as}
      <!-- a comment before the row root is not the root -->
      <li key={ a.key }>{ a.label }</li>
    {/for}
    <!-- {#for b in bs}<li>{ b }</li>{/for} -->
    {#for c in cs, i}
      <li class="x">{ c }</li>
    {/for}
    {#for n in 1...3}
      <li>{ n }</li>
    {/for}
  </ul>
</puzzle-view>

<script>
// {#for d in ds}<li>{ d }</li>{/for}
</script>`;
	assert.deepEqual(keylessLoops(source), ['c in cs']);
});

test('every item-form {#for} row in the registry has a key', async () => {
	const problems = [];
	for (const file of await pzlFiles(UI)) {
		const name = relative(UI, file);
		const counts = {};
		for (const loop of keylessLoops(await readFile(file, 'utf8'))) {
			counts[loop] = (counts[loop] || 0) + 1;
		}
		const allowed = ID_KEYED[name] || {};
		for (const loop of new Set([...Object.keys(counts), ...Object.keys(allowed)])) {
			const found = counts[loop] || 0;
			const ok = allowed[loop] || 0;
			if (found > ok) problems.push(`${name}: ${loop} — add key={ … } to the row root`);
			else if (found < ok) problems.push(`${name}: ${loop} — stale ID_KEYED entry (${found} of ${ok})`);
		}
	}
	assert.deepEqual(problems, []);
});
