// Cross-boundary drift guard: the runtime's KEY_FILTERS table
// (client-runtime/views/viewManager.js) hand-mirrors the compiler's
// eventKeyFilters map (compiler/internal/parser/parser.go). Neither side imports
// the other — the compiler emits '@event:enter' handlers and the runtime gates
// them on KeyboardEvent.key at patch time — so a modifier added or renamed on one
// side of the language boundary silently stops working unless BOTH tables carry
// it. This test reads the Go source as text, extracts the map, and asserts the
// two are byte-identical (keys AND values). The Go file is READ ONLY.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KEY_FILTERS } from '../client-runtime/views/viewManager.js';

// Pull `var eventKeyFilters = map[string]string{ ... }` out of parser.go and
// parse its `"key": "value"` entries into a plain object.
function parseGoEventKeyFilters(source) {
	const block = source.match(/var eventKeyFilters = map\[string\]string\{([\s\S]*?)\}/);
	if (!block) throw new Error('eventKeyFilters map not found in parser.go — did it move or get renamed?');
	const out = {};
	const entry = /"([^"]*)"\s*:\s*"([^"]*)"/g;
	let m;
	while ((m = entry.exec(block[1])) !== null) out[m[1]] = m[2];
	return out;
}

describe('event key-filter parity (runtime KEY_FILTERS ⇄ compiler eventKeyFilters)', () => {
	const parserGo = fileURLToPath(new URL('../compiler/internal/parser/parser.go', import.meta.url));
	const goFilters = parseGoEventKeyFilters(readFileSync(parserGo, 'utf8'));

	it('extracts a non-empty map from parser.go', () => {
		// Guard against a regex that silently matched nothing (which would make the
		// equality check trivially pass on two empty-ish tables).
		expect(Object.keys(goFilters).length).toBeGreaterThan(0);
	});

	it('runtime and compiler tables are identical (keys and values)', () => {
		expect(goFilters).toEqual(KEY_FILTERS);
	});
});
