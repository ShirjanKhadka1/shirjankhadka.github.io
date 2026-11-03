# tools/sector-map.json — DERIVED VIEW ONLY (Charter v4.2 item 4B)

**This file is NOT a source of truth.** It is regenerated from
`data/reference/instruments.json` (the adopted master) by
`tools/build-master-view.js` and nothing else. The old classifier that
built it (`tools/build-sector-map.js`) was deleted in 4B.

**Why the file still exists:** the live gate currently reads a served
sector map for its sector-taxonomy check. Deleting this file in 4B —
before 4C updates the gate to read the master (or
`data/reference/instruments-view.json`) directly — would break the gate.
So 4B keeps the path as a master-derived view and 4C retires it. No
in-repo consumer reads this file anymore (verified by
`tools/test-master-wiring.js`): the universe builder, the value screen,
and every JS consumer read the master or a master-derived payload.

**Semantics:** each entry is `{sector, instrument_type, derived_from,
derived: true}`. `sector: null` means the master row is UNCONFIRMED —
no sector asserted, never an "Others"/"Unclassified" bucket. TYPE
(`instrument_type`) decides equity inclusion, never sector.
