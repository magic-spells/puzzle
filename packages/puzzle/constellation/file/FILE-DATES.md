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
  - DECISION-D114-CALENDAR-DATE-FORMATTERS
verified_at: '2026-11-01T19:19:18.479Z'
verified_sha: eec9ac3752f9949b92e3d63609700f34a3ae241f
---

# dates.js

The single implementation of the D114 day-vs-instant rule
([[DECISION-D114-CALENDAR-DATE-FORMATTERS]]): `CalendarDate`, DATE_ONLY
detection, and the shared parse. Both `model.js` (every JSON boundary — upsert,
loads, save responses, storage restore) and `formatters/builtins.js` (display)
consume it; never classify dates a second way in either consumer.
