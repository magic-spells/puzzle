---
name: Calendar — ported month grid under DatePicker and DateRangePicker
status: built
framework: puzzle
props:
  - name: value
    type: string
  - name: month
    type: string
  - name: min
    type: string
  - name: max
    type: string
  - name: disabledDates
    type: string[] | (iso, Date) => boolean
  - name: locale
    type: string
  - name: firstDayOfWeek
    type: number
  - name: autofocus
    type: boolean
  - name: label
    type: string
  - name: frameless
    type: boolean
  - name: range
    type: '{ start, end }'
  - name: previewDate
    type: string
  - name: class
    type: string
connections:
  - DECISION-WRAP-WEB-COMPONENTS
  - DECISION-CONFIG-FIRST-API
  - DOC-REGISTRY
notes:
  - kind: state
    text: >-
      2026-11-08 (0.10.0 review, feat/0.10-pieces-date-range). Calendar: new `month` prop (P14-B1);
      grid aria-labelledby moved to the visible month span (P02-B1, Chromium AX tree now names grids
      "July 2026"); aria-live="polite" on that span (P02-B2); `@monthChange` DELETED (P02-B3): it
      missed same-month year jumps, nothing in packages/ called it, and its "DatePicker reads this"
      claim was false; deleting was smaller than fixing; `w-[17rem]` → `w-68`. DateRangePicker:
      grids anchored via `month` (B1, Chromium: Jul/Aug on open; picking Sep 19 in the right grid
      gives Sep/Oct, no jump to today); hover band no longer blinks in the 4px gaps between rows
      (B2+Q3: preview updates only on a found data-iso; the clears in _commitDay/onPreset and the
      !selecting branch are gone, close clears it); phone layout stacks rail and grids under sm (B3,
      375px: panel 37→319, scrollWidth 375; desktop rail stays 144px with border-r); dead panelStyle
      removed and the two {#if name} blocks merged (Q2). Known trade-off: DRP no longer passes
      Calendar `value`, so the months/years drill-down no longer highlights the start's month/year
      as selected.
  - kind: state
    text: >-
      2026-11-08 (PR #256 review fix). Supersedes the earlier note's "picking Sep 19 in the right
      grid gives Sep/Oct": DateRangePicker's anchor is now fixed while the panel is open
      (`this._anchor` kept while open, re-derived from start/end/today while closed). Chromium on
      the Two months demo: open Jul|Aug; clicking Aug 19 in the right grid keeps Jul|Aug and focus
      on that day; keyboard start pick in the right grid keeps focus, Escape closes and refocuses
      the trigger; right-grid Next then a left-grid start pick keeps Aug|Oct; reopen lands on the
      start month.
---

`registry/ui/calendar/Calendar.pzl`, a port (not a wrapper) of the `@magic-spells/date-picker`
grid: token-styled form-control markup is the case DECISION-WRAP-WEB-COMPONENTS allows to
port. DatePicker and DateRangePicker (`registry/ui/date-range-picker/DateRangePicker.pzl`)
compose it inside their popovers. Prop and callback details live in the file header.

## The shown month is separate from the selection

The displayed month, drill-down view and roving focus are LOCAL state. They are seeded on
the first `data()` run and re-seeded whenever `month || value` changes. `month` (an ISO
date, added 0.10.0) decides the shown month and paints no selection disc; without it the
`value` anchors the grid, then today clamped into `min`/`max`.

Why `month` exists: `value` drives both the anchor and the selected disc, so a piece that
needs a grid on a month it has not selected (DateRangePicker's right grid) had no way to
ask for one. Before 0.10.0 DateRangePicker anchored its two grids on `value: start` and
`value: end`, which showed the same month twice and threw the right grid back to today
whenever a new range started (end `''`).

DateRangePicker now passes only `month`: anchor = start, else end, else today clamped into
min/max; the right grid gets `addMonths(anchor, 1)`. The anchor is fixed while the panel is
open and follows the value only while closed, so picking a day never moves the grids (a
moving anchor re-seeded both Calendars and dropped focus to BODY) and each open lands on
the start. Endpoint discs come from `range`, so Calendar's own `value` stays unset there.
The two grids still navigate independently after opening; shared prev/next is a documented
gap.

## Accessibility

Each grid's `aria-labelledby` points at the visible month heading `<span>` (which is also
`aria-live="polite"`, so prev/next announces the new month). The label button keeps its
`aria-label` ("Choose month"/"Choose year"), which is why the id must not sit on the button:
accname lets the button's aria-label win over its text.
