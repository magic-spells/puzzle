import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Static wiring guards for the Calendar family's day snippet (0.7.0, framework D166),
// in the same spirit as sheet-wrapper.test.js: nothing here is unit-testable without a
// compiler and a DOM, but the WIRING is exactly what silently regresses.
//
// Why this matters more than it looks: Calendar declares its day marker with a paired
// fallback body that renders the day number. DatePicker and DateRangePicker own no
// marker of their own — they forward a caller's <Snippet fits="day" …> into the inner
// Calendar by invoking it PAIRED around a bare <Children/> (D166 snippet forwarding
// through the default marker). If someone self-closes <Calendar …/> again, nothing
// errors and nothing warns — the forwarding path simply disappears, Calendar renders
// its fallback, and every day cell shows a plain day number that looks exactly like a
// working calendar. The caller's snippet is silently dropped. There is deliberately no
// "unused snippet" diagnostic in the framework either (a marker inside a false {#if} is
// not evidence of a mistake), so this guard is the only thing standing between that
// regression and a release.

const read = async (path) => readFile(new URL(path, import.meta.url), 'utf8');

const CALENDAR = '../registry/ui/calendar/Calendar.pzl';

const FORWARDERS = [
	{ piece: 'date-picker', file: 'DatePicker.pzl', source: '../registry/ui/date-picker/DatePicker.pzl' },
	{
		piece: 'date-range-picker',
		file: 'DateRangePicker.pzl',
		source: '../registry/ui/date-range-picker/DateRangePicker.pzl',
	},
];

// Everything before the <script> block — the .pzl template section. Keeps the header
// comment's own prose about <Calendar>/<Children/> out of the match.
const templateOf = (source) => source.split(/^<script>/m)[0];

test('Calendar declares the day slot with the documented parameters', async () => {
	const template = templateOf(await read(CALENDAR));

	const marker = template.match(/<Slot\s+name="day"[\s\S]*?<\/Slot>/);
	assert.ok(marker, 'Calendar.pzl declares a paired <Slot name="day"> … </Slot>');

	// Argument names are the caller-facing contract (a <Snippet fits="day" …> binds by
	// name), so a rename here is a breaking change for every consumer's snippet.
	for (const arg of [
		'date',
		'day',
		'selected',
		'today',
		'outside',
		'disabled',
		'inRange',
		'rangeStart',
		'rangeEnd',
	]) {
		assert.match(marker[0], new RegExp(`\\b${arg}=\\{`), `day slot passes ${arg}`);
	}

	// Paired, with a fallback body: an unfilled position must still render the day
	// number, which is what keeps the snippet purely additive for existing callers.
	assert.match(marker[0], />\s*\{\s*d\.day\s*\}\s*<\/Slot>/, 'day slot falls back to the day number');
});

for (const forwarder of FORWARDERS) {
	test(`${forwarder.piece} invokes Calendar paired around a bare <Children/>`, async () => {
		const template = templateOf(await read(forwarder.source));

		const invocations = template.match(/<Calendar\b[\s\S]*?<\/Calendar>/g) || [];
		assert.equal(invocations.length, 1, `${forwarder.file} has exactly one paired <Calendar> invocation`);

		// A self-closing <Calendar …/> would leave no </Calendar> to match above, so
		// reaching here already proves the invocation is paired. Belt and braces:
		assert.doesNotMatch(
			template,
			/<Calendar\b[^>]*\/>/,
			`${forwarder.file} must not self-close <Calendar/> — that drops forwarded day snippets`
		);

		// The bare default marker is the forwarding vehicle. Bare means no attributes:
		// an argument-bearing marker stamps locally instead of forwarding.
		assert.match(
			invocations[0],
			/<Children\s*\/>/,
			`${forwarder.file} forwards caller snippets through a bare <Children/>`
		);

		// The pickers must not redeclare the day slot; one declaration (Calendar's)
		// serves every rendered grid.
		assert.doesNotMatch(template, /<Slot\s+name="day"/, `${forwarder.file} must not redeclare the day slot`);
	});
}

// The demo app compiles these copies, so the demo build is what actually exercises the
// forwarding path end to end (DateRangePickerDoc renders two grids from one snippet).
const copies = [
	['Calendar.pzl', CALENDAR, '../demo/app/components/ui/Calendar.pzl'],
	['DatePicker.pzl', FORWARDERS[0].source, '../demo/app/components/ui/DatePicker.pzl'],
	['DateRangePicker.pzl', FORWARDERS[1].source, '../demo/app/components/ui/DateRangePicker.pzl'],
];

test('registry and demo Calendar-family copies stay byte-identical', async () => {
	for (const [name, registryPath, demoPath] of copies) {
		const [registrySource, demoSource] = await Promise.all([
			readFile(new URL(registryPath, import.meta.url)),
			readFile(new URL(demoPath, import.meta.url)),
		]);
		assert.equal(Buffer.compare(registrySource, demoSource), 0, `${name} copy drifted`);
	}
});
