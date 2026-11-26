---
name: Calendar — ported month grid under DatePicker and DateRangePicker
status: verified
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
      Because DateRangePicker leaves Calendar's `value` unset, the months/years drill-down does not
      mark the start's month or year as selected; this is a known trade-off. DateRangePicker's hover
      preview updates only over a day button (a found `data-iso`), so the band holds across the gaps
      between rows; leaving the grid or closing the panel clears it.
verified_at: '2026-11-24T18:13:21.786Z'
verified_sha: 0b6e58cdc34055741ad520c827f3d9c2b58d4e77
---

`registry/ui/calendar/Calendar.pzl`, a port (not a wrapper) of the `@magic-spells/date-picker`
grid: token-styled form-control markup is the case DECISION-WRAP-WEB-COMPONENTS allows to
port. DatePicker and DateRangePicker (`registry/ui/date-range-picker/DateRangePicker.pzl`)
compose it inside their popovers. Prop and callback details live in the file header.

## The shown month is separate from the selection

The displayed month, drill-down view and roving focus are LOCAL state. The view is seeded
`'days'` in `created()`; the month and focus are seeded on the first `data()` run and
re-seeded whenever `month || value` changes. `month` (an ISO date) decides the shown month
and paints no selection disc; without it the `value` anchors the grid, then today clamped
into `min`/`max`.

Why `month` exists: `value` drives both the anchor and the selected disc, so a piece that
needs a grid on a month it has not selected (DateRangePicker's right grid) needs a separate
anchor. Two grids anchored on `value: start` and `value: end` show the same month twice and
throw the right grid back to today whenever a new range starts (end `''`).

DateRangePicker passes only `month`: anchor = start, else end, else today clamped into
min/max; the right grid gets `addMonths(anchor, 1)`. The anchor is fixed while the panel is
open and follows the value only while closed, so picking a day never moves the grids (a
moving anchor re-seeds both Calendars and drops focus to BODY) and each open lands on
the start. Endpoint discs come from `range`, so Calendar's own `value` stays unset there.
The two grids still navigate independently after opening; shared prev/next is a documented
gap.

## Accessibility

Each grid's `aria-labelledby` points at the visible month heading `<span>` (which is also
`aria-live="polite"`, so prev/next announces the new month). The label button keeps its
`aria-label` ("Choose month"/"Choose year"), which is why the id must not sit on the button:
accname lets the button's aria-label win over its text.
