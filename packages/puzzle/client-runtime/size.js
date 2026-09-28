/**
 * The template language's one built-in property, `.size` (D176). A compiled
 * module imports this as `__z` — only a module whose template reads `.size` —
 * and every template `x.size` compiles to `__z(x)`:
 *
 * - a list's size is its item count (`v.length`);
 * - a string's size is its count of Unicode code points, not UTF-16 units, so
 *   an emoji counts once — the same count `truncate` and Puzzle Sites use (a
 *   grapheme cluster such as a family emoji is still several code points);
 * - anything else reads its own `size` field: `file.size` on an object is the
 *   field, and a Map or Set answers its native size;
 * - a missing value (`null`/`undefined`) has no size: the result is undefined,
 *   so it displays nothing and `{#if x.size > 0}` is false.
 */
export function sizeOf(v) {
	if (Array.isArray(v)) return v.length;
	if (typeof v == 'string') {
		let n = 0;
		for (const _ of v) n++;
		return n;
	}
	return v?.size;
}
