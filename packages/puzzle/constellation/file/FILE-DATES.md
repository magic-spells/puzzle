---
name: shared date rule
status: verified
path: client-runtime/dates.js
language: javascript
summary: >-
  The D114 day-vs-instant rule: CalendarDate, DATE_ONLY detection, and the shared parse used at
  every JSON boundary.
connections:
  - COMPONENT-PUZZLE-MODEL
  - COMPONENT-FORMATTERS
verified_at: '2026-08-24T18:51:29.856Z'
verified_sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
notes:
  - kind: verified
    text: New source binding for client-runtime/dates.js.
    sha: 31e1b877e13b623c27f82efba25d6b3da8e7aede
---

Source binding for the owning component cards. Behavioral intent stays in the
connected components; this card anchors that plan to `client-runtime/dates.js`.

Extracted so the D114 calendar-date rule has exactly one implementation: both
`model.js` (every JSON boundary — upsert, loads, save responses, storage
restore) and `formatters/builtins.js` (display) consume it, and they classified
dates independently before.
