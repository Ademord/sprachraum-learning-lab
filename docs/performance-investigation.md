# Marking and synchronization performance

Investigated 22 September 2026. Baseline: `c3d94dc`.

## Cause and changes

The strongest reproducible cause was in the browser, including solo lessons. Pronunciation rendering compared generated HTML with the browser's serialized `innerHTML`. Boolean attributes serialize differently, and keyboard navigation changes `tabindex`, so the comparison kept failing. Every paint replaced all eight reading paragraphs and their 752 word targets. Selection events caused additional paints.

The renderer now caches its inputs per paragraph node. A mark changes its own paragraph and, when needed, the previous active mark's paragraph. Unchanged counts, attributes and keyboard tab stops are left alone. Selection events only release a previously deferred update. Incoming updates preserve an active selection and wait until a pointer's click has completed. Scroll/resize positioning is grouped into animation frames. Identical selected words still use the current occurrence's offsets.

There was a separate synchronization cost: even unchanged polling responses captured, validated, cloned and saved the complete session. The bridge now captures only after a local change, and only flushes that change before applying an actual incoming snapshot. Queue persistence happens when the queue changes. Repeated unsent edits to one field are combined; attempted or restored edits retain their IDs and payloads because the server may already have accepted them.

Applying pending operations now copies the changed field instead of cloning the entire session per operation. Unchanged room polls read membership/revision metadata from D1 without retrieving lesson or session blobs. Changed polls fetch the session without the lesson, and recheck membership after that read.

## Evidence

The automated measurements use jsdom and the actual application code, with the 752-word demo. These are counts of work, not browser frame-rate or hosted-load measurements.

| Check | Before | After |
| --- | --- | --- |
| Paragraph replacements across 20 unchanged paints | 160 | 0 |
| Reading-material DOM mutations across those paints | 15,220 | 0 |
| Full-passage rendering on selection-only events | Triggered | None |
| Backup exports / localStorage writes across 10 settled live polls | Triggered on every poll | 0 / 0 |
| Unchanged poll's database projection | Whole row, including lesson and session | Membership and revision only |

A first mark replaces one paragraph. A mark in another paragraph replaces two, including the previous active mark. Tests also exercise selecting repeated identical words, a remote update during a local click, dirty writing during an incoming response, and uncertain retries. The complete import, export, role, conflict and offline-recovery suite passes.

A local native-browser smoke check exercised the full reading, three successive marks, review, removal and switching views. No browser console warnings or errors were recorded during that check. It was not a CPU trace or a multi-device load test.

## Architecture and remaining limits

The app still uses serialized HTTP requests and roughly one-second revision polling. A mark is applied locally before synchronization. Changing transport would not repair the rendering bug. The existing room API checks membership, applies field-level compare-and-set operations and deduplicates retries; these guarantees remain in place.

Changed responses still carry the complete session, and actual edits still save local session data synchronously. Full validation remains on import/export and before saving shared edits. Rooms are bounded by a 1.6 MB session limit, 500 marks and 40 operations per request. Server writes still validate and store a snapshot per operation. Idle requests still occur once per second per connected browser.

This fixes the measured waste; it is not a certification for an arbitrary number of simultaneous classes. Before a larger rollout, measure concurrent-room latency, Worker/D1 costs and browser responsiveness with large imported lessons and notebooks. If changed snapshots dominate, a revision-delta response is the next protocol change. A push transport would need a room coordinator, reconnect/replay handling and the same authorization checks; replacing polling alone would not remove snapshot or DOM costs.

Run `npm test`. The focused checks are `scripts/test-performance.mjs`, `scripts/test-transport-performance.mjs` and `scripts/test-collaboration.mjs`.
