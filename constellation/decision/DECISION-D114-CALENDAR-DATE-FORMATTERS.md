---
name: >-
  D114 — a bare YYYY-MM-DD is a calendar date: date formatters parse it as local, so it displays as
  written in every timezone
status: built
connections:
  - COMPONENT-FORMATTERS
  - FILE-FORMATTER-BUILTINS
  - DECISION-D112-STORE-ID-KEY-NORMALIZATION
---

The built-in date formatters (`date`, and through it `time`/`datetime`, plus
`timeago` and `in_timezone`) treat a bare `YYYY-MM-DD` string as a **calendar
date**: `date`/`timeago` parse it as local midnight instead of letting
`new Date(v)` apply the ES spec's UTC-midnight rule, and `in_timezone` passes
it through untouched — a day names no instant, so there is nothing to
re-express in another zone. `{ post.publishedAt | date }` of `"2026-07-24"`
now renders `07/24/2026` for every reader; before, anyone west of UTC saw
`07/23/2026`. Everything that carries its own time or zone — Date instances,
timestamps, full ISO datetimes — is untouched.

## Context

The ES spec parses date-only ISO forms as UTC midnight, while
`Intl.DateTimeFormat` renders in the viewer's zone. A date-only value is
almost always a *calendar* fact (a birthday, a due date, a publish date) —
the author means "this day", not "this instant" — so the UTC round trip
showed the previous day to half the planet. The failure is quiet, data-shaped
(`"2026-07-24"` is exactly what JSON APIs and `<input type="date">` produce),
and invisible to anyone testing east of UTC.

## Decision

- One `parseDateInput(v)` helper: a string matching `^\d{4}-\d{2}-\d{2}$`
  constructs `new Date(y, m-1, d)` — local midnight — with a
  **round-trip check** (`getFullYear/getMonth/getDate` must echo the parsed
  components). A mismatch means the components name a day that doesn't exist;
  it is **coerced to an Invalid Date** so the callers' existing fail-soft
  returns the raw value. Deliberately not a `new Date(v)` fallback: the ES
  grammar accepts any day ≤ 31, so `"2026-02-31"` would silently roll into
  March — TZ-dependently — while `"2026-13-01"` (which fails the grammar)
  returned raw; coercion makes every invalid component behave the same.
  Every other input passes straight to `new Date(v)`.
- Used by `date()`, `timeago()`, and `in_timezone()` — one parse rule for the
  whole family (`time`/`datetime` delegate to `date`). The same
  one-identity-rule principle as [[DECISION-D112-STORE-ID-KEY-NORMALIZATION]].
- **`in_timezone` is a no-op on calendar dates.** Its contract is "take an
  instant, re-express its wall clock in a named zone" — a calendar date has no
  instant, so it returns the parsed local-midnight Date unchanged. Shifting
  from ANY midnight anchor (local or UTC) makes the rendered day a function of
  the viewer's zone — the exact property this decision exists to eliminate.
- **`iso` preset is idempotent on calendar dates**: `date('2026-07-24',
  'iso')` returns `'2026-07-24'` unchanged. `toISOString()` of local midnight
  would emit a timezone-dependent instant — the ISO form of a calendar date
  is itself.
- Strict match only: no trimming, no `2026-7-24` single-digit forms — those
  fall through to the engine's legacy parsing exactly as before.

## Alternatives rejected

- **Format date-only values in UTC instead** (keep UTC parse, add
  `timeZone: 'UTC'` to the Intl options for them): `date` would render
  correctly, but `timeago` would measure from UTC midnight instead of the day
  the author named in the reader's frame, and it forks the Intl options object
  per input shape. (`in_timezone` is no argument for either anchor: it must
  not shift a calendar date at all, so the anchor debate never reaches it —
  the first shipped cut of this decision got that backwards and shifted local
  midnight, which made its output viewer-dependent.)
- **A `utc` preset/flag the author opts into** — the default is the bug; an
  opt-out nobody discovers fixes nobody.
- **Timezone-shifting all output to a configured app zone** — a much bigger
  feature (per-app zone config), orthogonal to the calendar-date semantics,
  and `in_timezone` already exists for explicit shifts.

## Consequences

- Date-only strings display as written everywhere; `timeago('2026-07-24')`
  measures from local midnight (the day the author named); `in_timezone`
  returns a calendar date unshifted, so
  `'2026-07-24' | in_timezone: <any zone> | date` renders `07/24/2026` for
  every viewer.
- The `iso` preset's output for date-only input changes from
  `'2026-07-24T00:00:00.000Z'` to `'2026-07-24'` — deterministic and
  round-trippable where the old form was a UTC-midnight artifact.
- Behavior for Date instances, timestamps, and full ISO datetimes is
  byte-identical (pinned by tests against the pre-D114 construction).
- `"2026-02-31"` previously rendered as a rolled March date (TZ-dependent);
  it now fails soft to the raw string — the one deliberate behavior change
  beyond date-only display itself.
- Tests pin **absolute output under explicit process zones**
  (`tests/formatters-timezone.test.js`: one Node subprocess per zone — Node
  caches the zone in ICU at startup, so mid-process `TZ` stubbing is not
  trustworthy). A formatter-vs-locally-built-`Date` comparison moves with the
  process zone on BOTH sides and passes even while output is viewer-dependent
  — exactly how the original `in_timezone` cut slipped through. The zone list
  includes `Pacific/Honolulu`, west of every listed process zone, so a
  day-shifting `in_timezone` fails in ALL of them, not just some.
- SPEC §6's Formatters bullet documents the calendar-date rule.
