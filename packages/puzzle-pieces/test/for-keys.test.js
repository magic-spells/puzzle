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
// toasts carry one for aria-activedescendant or close-by-id anyway). A new
// keyless loop fails here: add a key, or add it to the list once its rows
// really do carry an `id`.

const ID_KEYED = new Set([
	'combobox/Combobox.pzl: row in rows',
	'command/Command.pzl: row in rows',
	'emoji-picker/EmojiPicker.pzl: row in rows',
	'emoji-picker-simple/EmojiPickerSimple.pzl: cell in cells',
	'emoji-picker-simple/EmojiPickerSimple.pzl: tab in tabs',
	'input-otp/InputOtp.pzl: item in items',
	'multi-select/MultiSelect.pzl: chip in chips',
	'multi-select/MultiSelect.pzl: row in rows',
	'tags-input/TagsInput.pzl: chip in chips',
	'time-picker/TimePicker.pzl: opt in col.options',
	'toast/Toaster.pzl: item in items',
]);

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

test('every item-form {#for} row in the registry has a key', async () => {
	const keyless = [];
	const seen = new Set();
	for (const file of await pzlFiles(UI)) {
		const source = await readFile(file, 'utf8');
		// The template only: a loop quoted in a script comment is not a loop.
		const end = source.indexOf('</puzzle-view>');
		const template = end === -1 ? source : source.slice(0, end);
		for (const m of template.matchAll(/\{#for\s+([^}]*)\}\s*/g)) {
			const header = m[1].trim();
			if (header.includes('...')) continue; // range rows are keyed by value
			const body = template.slice(m.index + m[0].length);
			const name = `${relative(UI, file)}: ${header.replace(/,\s*\w+$/, '')}`;
			if (!body.startsWith('<')) {
				keyless.push(`${name} (row root is not an element)`);
				continue;
			}
			if (/\skey=/.test(openingTag(body))) continue;
			seen.add(name);
			if (!ID_KEYED.has(name)) keyless.push(name);
		}
	}
	assert.deepEqual(keyless, [], 'add key={ … } to these {#for} row roots');
	const stale = [...ID_KEYED].filter((name) => !seen.has(name));
	assert.deepEqual(stale, [], 'these ID_KEYED entries no longer match a keyless loop');
});
