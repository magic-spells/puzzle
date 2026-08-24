import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// A date-only field must round-trip BYTE-IDENTICALLY: "2026-08-23" in,
// "2026-08-23" out, in every process time zone.
//
// It did not. coerceJSONDates revived a bare YYYY-MM-DD to LOCAL midnight
// (D114's display rule, correct on its own), and the plain Date it produced
// then serialized through Date#toJSON — `toISOString()`, a UTC instant. East of
// UTC that instant names the PREVIOUS day, so every Rails/Django `DateField`
// user in Berlin or Tokyo saved the value back one day earlier than they loaded
// it. Silent, data-shaped, and invisible to anyone testing in UTC.
//
// This has to be a multi-process suite for the same reason
// tests/formatters-timezone.test.js is: Node reads TZ once at startup and caches
// the zone in ICU, and an expectation built from a local `new Date(...)` moves
// with the process zone on both sides and passes while the value is wrong. Pin
// ABSOLUTE strings, in several zones, from fresh processes.

const MODEL = new URL('../client-runtime/model.js', import.meta.url).href;
const BUILTINS = new URL('../client-runtime/formatters/builtins.js', import.meta.url).href;

// Berlin (+02) and Tokyo (+09) are east of UTC — where the old code lost a day.
// Kiritimati (+14) is the extreme of that direction; Los Angeles (-07) and
// Honolulu (-10) cover the west, where the instant kept the right day but still
// stopped being a calendar date.
const ZONES = [
	'UTC',
	'Europe/Berlin',
	'Asia/Tokyo',
	'America/Los_Angeles',
	'Pacific/Kiritimati',
	'Pacific/Honolulu',
];

const PROBE = `
import { PuzzleModel, coerceJSONDates } from ${JSON.stringify(MODEL)};
import { date, in_timezone, datetime } from ${JSON.stringify(BUILTINS)};

class Post extends PuzzleModel {
	static schema = {
		id: { type: 'string' },
		// A calendar date: a Rails/Django DateField, or an <input type="date">.
		publishedOn: { type: 'date' },
		// An instant: a DateTimeField. Must stay an instant.
		startsAt: { type: 'date' },
	};
}

const hydrate = (payload) => new Post(coerceJSONDates(Post, payload));

const record = hydrate({
	id: 'p1',
	publishedOn: '2026-08-23',
	startsAt: '2026-08-23T10:00:00.000Z',
});

// What the adapter actually puts on the wire: JSON.stringify over toJSON().
const wire = (r) => JSON.parse(JSON.stringify(r.toJSON()));

process.stdout.write(
	JSON.stringify({
		zone: Intl.DateTimeFormat().resolvedOptions().timeZone,

		// The whole finding, in one line.
		saved: wire(record),

		// Save → server echoes it back → save again. A drift of one day per
		// round trip would compound here even if a single hop looked stable.
		resaved: wire(hydrate(wire(record))),

		// Year boundaries are where a one-day slip is most visible, and the two
		// DST transitions are where local midnight is least ordinary.
		edges: {
			newYear: wire(hydrate({ id: 'e1', publishedOn: '2026-01-01' })).publishedOn,
			yearEnd: wire(hydrate({ id: 'e2', publishedOn: '2026-12-31' })).publishedOn,
			dstSpring: wire(hydrate({ id: 'e3', publishedOn: '2026-03-08' })).publishedOn,
			dstFall: wire(hydrate({ id: 'e4', publishedOn: '2026-11-01' })).publishedOn,
			leapDay: wire(hydrate({ id: 'e5', publishedOn: '2028-02-29' })).publishedOn,
		},

		// It is still a Date: validation's type gate, min/max, and every app-side
		// \`instanceof Date\` check must keep working on a revived calendar date.
		isDate: record.publishedOn instanceof Date,
		// ...and still D114's LOCAL midnight, so it DISPLAYS as the day written.
		localWall: [
			record.publishedOn.getFullYear(),
			String(record.publishedOn.getMonth() + 1).padStart(2, '0'),
			String(record.publishedOn.getDate()).padStart(2, '0'),
			String(record.publishedOn.getHours()).padStart(2, '0'),
		].join('-'),
		shown: date(record.publishedOn, 'date', 'en-US'),

		// The two consumers the same root cause defeated. Both were testing
		// \`typeof v === 'string'\`, which a revived field is not.
		isoOfRevived: date(record.publishedOn, 'iso'),
		isoAfterTimezone: date(in_timezone(record.publishedOn, 'UTC'), 'iso'),
		shownAfterTimezone: date(in_timezone(record.publishedOn, 'Pacific/Honolulu'), 'date', 'en-US'),
		datetimeAfterTimezone: datetime(in_timezone(record.publishedOn, 'Asia/Tokyo'), 'datetime', 'en-US'),

		// An instant is NOT a calendar date and must be untouched by all of this.
		instantSaved: wire(record).startsAt,
		instantIso: date(record.startsAt, 'iso'),

		// A Date the app built itself carries no calendar-date claim — the
		// framework cannot read intent off a plain Date, so it stays an instant.
		plainDateSaved: wire(hydrate({ id: 'p2', publishedOn: new Date(Date.UTC(2026, 7, 23, 12)) })).publishedOn,

		// Fail-soft is unchanged: a nonexistent day is left exactly as it arrived
		// (D114) rather than rolling into the next month.
		badDaySaved: wire(hydrate({ id: 'p3', publishedOn: '2026-02-31' })).publishedOn,
	})
);
`;

/** Run the probe batch in a fresh node process pinned to `tz`. */
function probe(tz) {
	const out = execFileSync(process.execPath, ['--input-type=module', '-e', PROBE], {
		cwd: fileURLToPath(new URL('..', import.meta.url)),
		env: { ...process.env, TZ: tz },
		encoding: 'utf8',
	});
	return JSON.parse(out);
}

const results = Object.fromEntries(ZONES.map((tz) => [tz, probe(tz)]));

describe('a date-only field round-trips byte-identically under any process time zone', () => {
	it('spawned each probe in the zone it asked for', () => {
		// Guards the mechanism: if TZ stopped taking effect, every zone would agree
		// for the wrong reason and the whole file would go green while broken.
		for (const tz of ZONES) expect(results[tz].zone).toBe(tz);
	});

	describe.each(ZONES)('TZ=%s', (tz) => {
		it('saves the calendar date it loaded, not a UTC instant', () => {
			// Berlin used to write "2026-08-22T22:00:00.000Z" here and Tokyo
			// "2026-08-22T15:00:00.000Z" — both the day before.
			expect(results[tz].saved).toEqual({
				id: 'p1',
				publishedOn: '2026-08-23',
				startsAt: '2026-08-23T10:00:00.000Z',
			});
		});

		it('is a fixed point: a save/echo/save cycle never drifts', () => {
			expect(results[tz].resaved).toEqual(results[tz].saved);
		});

		it('holds at year boundaries, both DST transitions, and a leap day', () => {
			expect(results[tz].edges).toEqual({
				newYear: '2026-01-01',
				yearEnd: '2026-12-31',
				dstSpring: '2026-03-08',
				dstFall: '2026-11-01',
				leapDay: '2028-02-29',
			});
		});

		it('is still a Date at LOCAL midnight, so D114 display is unchanged', () => {
			expect(results[tz].isDate).toBe(true);
			expect(results[tz].localWall).toBe('2026-08-23-00');
			expect(results[tz].shown).toBe('08/23/2026');
		});

		it("keeps date(v,'iso') and in_timezone working on a REVIVED value", () => {
			// Both branched on `typeof v === 'string'`, which is false once the
			// store has revived the field — so both silently took the instant path.
			expect(results[tz].isoOfRevived).toBe('2026-08-23');
			expect(results[tz].isoAfterTimezone).toBe('2026-08-23');
			expect(results[tz].shownAfterTimezone).toBe('08/23/2026');
			expect(results[tz].datetimeAfterTimezone).toBe('08/23/2026, 12:00 AM');
		});

		it('leaves real instants and plain Dates alone', () => {
			expect(results[tz].instantSaved).toBe('2026-08-23T10:00:00.000Z');
			expect(results[tz].instantIso).toBe('2026-08-23T10:00:00.000Z');
			// No calendar-date claim on a Date the app constructed itself.
			expect(results[tz].plainDateSaved).toBe('2026-08-23T12:00:00.000Z');
		});

		it('still fails soft on a day that does not exist (D114)', () => {
			expect(results[tz].badDaySaved).toBe('2026-02-31');
		});
	});
});
