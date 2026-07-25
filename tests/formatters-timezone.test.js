import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Time-zone behaviour of the date formatters is only testable against ABSOLUTE
// expected strings. The in-process suite (tests/formatters.test.js) runs in
// whatever zone the machine happens to be in, so any assertion that builds its
// expectation with a local `new Date(...)` moves in lockstep with the value it
// is checking and passes even when the formatter is wrong. That is exactly how
// the D114 follow-up bug survived: `in_timezone('2026-07-24', 'America/New_York')`
// rendered 07/23/2026 for viewers east of the target zone, and nothing failed.
//
// So: pin absolute outputs, and run them under several process time zones.
// Node reads TZ once at startup and caches the zone in ICU, so a mid-process
// `process.env.TZ` change is not reliably honoured — the only trustworthy
// mechanism is a fresh process per zone. One subprocess per zone runs the whole
// batch of probes and returns JSON, so the cost is 4 spawns for the file.

const BUILTINS = new URL('../client-runtime/formatters/builtins.js', import.meta.url).href;

// Zones chosen so that every date-only assertion below is broken by a
// day-shifting `in_timezone` in at least one of them, and the Honolulu probe is
// broken in ALL of them (its offset is west of every zone in the list).
const ZONES = ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'America/New_York'];

const PROBE = `
import { in_timezone, date, datetime } from ${JSON.stringify(BUILTINS)};

// Local wall-clock components of the returned Date. in_timezone's contract is
// "a Date whose LOCAL fields read as the wall clock in tz", so these components
// are the time-zone-stable observable — getTime() is not.
const wall = (d) =>
	Number.isNaN(d.getTime())
		? 'Invalid Date'
		: [
				d.getFullYear(),
				String(d.getMonth() + 1).padStart(2, '0'),
				String(d.getDate()).padStart(2, '0'),
				String(d.getHours()).padStart(2, '0'),
				String(d.getMinutes()).padStart(2, '0'),
		  ].join('-');

const shown = (v, tz) => date(in_timezone(v, tz), 'date', 'en-US');

process.stdout.write(
	JSON.stringify({
		zone: Intl.DateTimeFormat().resolvedOptions().timeZone,

		// A bare YYYY-MM-DD names a DAY. Every one of these must be the day as
		// written, in every process zone, for every target zone.
		calendar: {
			'2026-07-24 @ Asia/Tokyo': shown('2026-07-24', 'Asia/Tokyo'),
			'2026-03-01 @ America/New_York': shown('2026-03-01', 'America/New_York'),
			'2026-07-24 @ America/New_York': shown('2026-07-24', 'America/New_York'),
			'2026-07-24 @ Pacific/Honolulu': shown('2026-07-24', 'Pacific/Honolulu'),
			'2026-07-24 @ Pacific/Kiritimati': shown('2026-07-24', 'Pacific/Kiritimati'),
			'2026-07-24 @ UTC': shown('2026-07-24', 'UTC'),
			'2026-01-01 @ Pacific/Honolulu': shown('2026-01-01', 'Pacific/Honolulu'),
			'2026-12-31 @ Pacific/Kiritimati': shown('2026-12-31', 'Pacific/Kiritimati'),
		},

		// ...and it stays midnight of that day, never 19:00 of the day before.
		calendarWall: {
			'2026-07-24 @ Asia/Tokyo': wall(in_timezone('2026-07-24', 'Asia/Tokyo')),
			'2026-07-24 @ Pacific/Honolulu': wall(in_timezone('2026-07-24', 'Pacific/Honolulu')),
		},
		calendarDatetime: datetime(in_timezone('2026-07-24', 'Asia/Tokyo'), 'datetime', 'en-US'),

		// A full ISO INSTANT names a moment, so it MUST still be re-expressed.
		instant: {
			'Z @ Asia/Tokyo': wall(in_timezone('2026-07-24T00:00:00Z', 'Asia/Tokyo')),
			'Z @ America/Los_Angeles': wall(in_timezone('2026-07-24T00:00:00Z', 'America/Los_Angeles')),
			'Z @ UTC': wall(in_timezone('2026-07-24T00:00:00Z', 'UTC')),
			'offset @ UTC': wall(in_timezone('2026-07-24T00:00:00+09:00', 'UTC')),
			'Date instance @ Asia/Tokyo': wall(in_timezone(new Date('2026-07-24T00:00:00Z'), 'Asia/Tokyo')),
			'timestamp @ Asia/Tokyo': wall(in_timezone(Date.UTC(2026, 6, 24), 'Asia/Tokyo')),
		},

		// Fail-soft paths must not become time-zone-dependent either.
		failSoft: {
			'bad tz on a calendar date': wall(in_timezone('2026-07-24', 'Not/AZone')),
			'bad tz on an instant': wall(in_timezone('2026-07-24T00:00:00Z', 'Not/AZone')),
			'nonexistent day': wall(in_timezone('2026-02-31', 'Asia/Tokyo')),
			'garbage': wall(in_timezone('nonsense', 'Asia/Tokyo')),
		},

		// The plain date/timeago path D114 already fixed — pinned here too so a
		// regression shows up under a foreign zone rather than only in the wild.
		plain: {
			date: date('2026-07-24', 'date', 'en-US'),
			long: date('2026-01-01', 'long', 'en-US'),
			iso: date('2026-07-24', 'iso'),
			isoInstant: date('2026-07-24T12:00:00Z', 'iso'),
		},
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

describe('date formatters under a foreign process time zone (D114)', () => {
	it('spawned each probe in the zone it asked for', () => {
		// Guards the mechanism itself: if TZ stopped taking effect, every zone
		// would agree for the wrong reason and the whole file would go green.
		for (const tz of ZONES) expect(results[tz].zone).toBe(tz);
	});

	describe.each(ZONES)('TZ=%s', (tz) => {
		it('renders a calendar date as the day written, whatever the target zone', () => {
			// in_timezone has nothing to re-express for a bare YYYY-MM-DD: it names
			// a day, and shifting it moves the day. These are absolute strings on
			// purpose — an expectation built from a local `new Date` would drift
			// with the process zone and never fail.
			expect(results[tz].calendar).toEqual({
				'2026-07-24 @ Asia/Tokyo': '07/24/2026',
				'2026-03-01 @ America/New_York': '03/01/2026',
				'2026-07-24 @ America/New_York': '07/24/2026',
				// Honolulu (-10) is west of every zone in ZONES, so a day-shifting
				// in_timezone breaks this one in EVERY process zone.
				'2026-07-24 @ Pacific/Honolulu': '07/24/2026',
				// Kiritimati (+14) is east of every zone, covering the other direction.
				'2026-07-24 @ Pacific/Kiritimati': '07/24/2026',
				'2026-07-24 @ UTC': '07/24/2026',
				// Year boundaries are where a one-day slip is most visible.
				'2026-01-01 @ Pacific/Honolulu': '01/01/2026',
				'2026-12-31 @ Pacific/Kiritimati': '12/31/2026',
			});
		});

		it('keeps a calendar date at local midnight of that day', () => {
			expect(results[tz].calendarWall).toEqual({
				'2026-07-24 @ Asia/Tokyo': '2026-07-24-00-00',
				'2026-07-24 @ Pacific/Honolulu': '2026-07-24-00-00',
			});
			expect(results[tz].calendarDatetime).toBe('07/24/2026, 12:00 AM');
		});

		it('still re-expresses a real instant in the target zone', () => {
			// The half of in_timezone that must keep working: UTC midnight is 09:00
			// the same morning in Tokyo, 17:00 the evening before in Los Angeles.
			expect(results[tz].instant).toEqual({
				'Z @ Asia/Tokyo': '2026-07-24-09-00',
				'Z @ America/Los_Angeles': '2026-07-23-17-00',
				'Z @ UTC': '2026-07-24-00-00',
				// 00:00+09:00 is 15:00Z the previous day.
				'offset @ UTC': '2026-07-23-15-00',
				// Date instances and timestamps are instants too — never date-only.
				'Date instance @ Asia/Tokyo': '2026-07-24-09-00',
				'timestamp @ Asia/Tokyo': '2026-07-24-09-00',
			});
		});

		it('fails soft to the parsed date without a zone-dependent shift', () => {
			expect(results[tz].failSoft).toEqual({
				// An unknown zone throws at DateTimeFormat construction; the calendar
				// date was already returned un-shifted before that could happen.
				'bad tz on a calendar date': '2026-07-24-00-00',
				// The instant falls back to itself, so its wall clock is the process
				// zone's — assert only that it is a valid date, not a fixed string.
				'bad tz on an instant': expect.stringMatching(/^2026-07-2[34]-\d\d-\d\d$/),
				// D114 coerces a spec-legal-but-nonexistent day to Invalid Date.
				'nonexistent day': 'Invalid Date',
				'garbage': 'Invalid Date',
			});
		});

		it('renders plain calendar dates as written', () => {
			expect(results[tz].plain).toEqual({
				date: '07/24/2026',
				long: 'January 01, 2026',
				iso: '2026-07-24',
				isoInstant: '2026-07-24T12:00:00.000Z',
			});
		});
	});
});
