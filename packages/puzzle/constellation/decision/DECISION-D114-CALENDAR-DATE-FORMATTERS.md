---
name: >-
  D114 — A bare YYYY-MM-DD is a calendar date: parsed as local midnight, tagged CalendarDate,
  written back as a day
status: verified
connections:
  - COMPONENT-FORMATTERS
  - FILE-FORMATTER-BUILTINS
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
verified_at: '2026-11-01T19:23:00.473Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
code_refs:
  - client-runtime/dates.js
  - client-runtime/formatters/builtins.js
  - client-runtime/model.js
---

# D114 — A bare `YYYY-MM-DD` is a calendar date

A date-only string is almost always a *day* (birthday, due date, publish date),
not an instant. The ES spec parses it as UTC midnight while `Intl` renders in
the viewer's zone, so everyone west of UTC would see the previous day. Puzzle
treats a bare `YYYY-MM-DD` as a calendar date everywhere — in the date functions
and across the store's JSON boundary. Instants (Dates, timestamps, full ISO
datetimes) are unaffected.

## Decision

- **One parse rule** (`client-runtime/dates.js`, shared by the date functions and
  the datastore — which must not import the function-library graph): a string
  matching `^\d{4}-\d{2}-\d{2}$` becomes local midnight `new Date(y, m-1, d)`,
  with a round-trip check. A day that doesn't exist (`2026-02-31`) becomes an
  Invalid Date — never `new Date(v)`, whose grammar would roll it into March,
  TZ-dependently. Strict match only (no trimming, no single-digit parts).
- **`CalendarDate extends Date`** carries the "this is a day" claim on the value,
  because the store revives `date()` fields at hydration and every consumer
  downstream sees a Date. `instanceof Date` still holds (validation, Intl,
  comparisons); `toJSON` writes the `YYYY-MM-DD` back, so a save round-trips the
  day instead of a UTC instant that names the previous day east of UTC.
  `isCalendarDate(v)` is the test.
- **Consumers:** `date`/`time`/`datetime`/`timeago` read through
  `parseDateInput`, so a calendar date renders as written and `timeago` measures
  from the day in the reader's frame. The `iso` preset returns the day itself
  for a calendar date (and for `date()`). `in_timezone` returns a calendar date
  **unshifted** — a day has no instant to re-express, and shifting any midnight
  anchor makes output viewer-dependent.
- **Unreadable input:** absent values (`null`, `undefined`, `''`, booleans —
  `noDate`) render nothing; an unparseable string renders as itself; any other
  non-date (`NaN`, an Invalid Date) renders nothing. Numeric 0 is a real epoch
  timestamp. `in_timezone` returns `''` for an absent or invalid date.

## Gotchas

- A plain `new Date(2026, 7, 23)` built by app code has no calendar claim and
  saves as an instant; only values *arriving* as `YYYY-MM-DD` are tagged.
- Tests assert **absolute output under explicit process zones**, one Node
  subprocess per zone (Node caches the zone at startup):
  `formatters-timezone` and `model-calendar-date-roundtrip`. Comparing against a
  locally built `new Date` moves with the zone on both sides and passes while
  broken; the zone list includes `Pacific/Honolulu` so a day shift fails
  everywhere.

## Alternatives rejected

- **Keep the UTC parse, render date-only values with `timeZone: 'UTC'`** —
  `timeago` would measure from UTC midnight, and Intl options fork per input
  shape.
- **An opt-in `utc` flag** — the default is the bug.
- **A configured app timezone** — a bigger, orthogonal feature; `in_timezone`
  covers explicit shifts.
- **A flag property instead of a subclass** — lost to spreads and copies;
  `toJSON` on the class is the one hook every write path consults.
