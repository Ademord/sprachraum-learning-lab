# Sprachraum

A separate prototype for a teacher and learner working through German on one screen or via screen share.

The frontend is plain HTML, CSS and JavaScript. Solo lessons work locally. Shared sessions use a small Cloudflare Worker and D1 database on Sites. No AI API key is needed. Fonts load from Google Fonts with local sans-serif fallbacks.

For development, use Node 22.13 or later, run `npm ci`, then `npm run dev`. The local server is at `http://127.0.0.1:4186` and stores its test database in ignored `.local/`. Its mock identity defaults to a learner; a separate browser profile can use the local cookie `sprachraum-dev-role=teacher`. This mock identity exists only in the local server, never in the deployed Worker. Run `npm test` for checks and `npm run build` for a deployable Worker, frontend assets and migrations. `npm run db:generate` creates new Drizzle migrations; applied migration files must remain immutable.

## Teacher feedback and shared sessions

The **Learner / Teacher** switch changes the local view. **Mark words** is a single on/off tool, initially off. Click or tap a word to mark it immediately, or drag across a phrase; partial drags snap to complete words. Touch selection handles also offer an explicit **Mark selected phrase** action. Clicking an existing mark opens its note alongside the text. The non-modal rail shows one mark, sentence context, optional feedback, previous/next, all marks and undo. Turning the tool off returns to lesson tasks. Keyboard users can Tab into the text, move with arrows, extend a phrase with Shift + arrows and mark with Enter. Ctrl/Cmd + Z undoes marking outside text fields.

Learners toggle **Review pronunciation** when ready. The same rail shows feedback and practice progress while keeping the passage usable. On narrow screens it becomes a bounded bottom panel. All marks, notes and practice state retain the existing synchronization and JSON backup format. The lesson title stays compact; its goals appear on hover, keyboard focus or a tap.

In Teacher view, a small white × appears at the top-right only while hovering over a highlight or the × itself. The transparent hover area extends 2 px past each edge without moving the text, including individual lines of a wrapped phrase. The × anchors to the actual hovered line and sits outside the animated app shell, so viewport coordinates remain consistent. Scrolling, layout changes and font loading recheck its position; scrolling away hides it. It removes that mark, with Undo available. The control sits outside the passage so text anchors stay unchanged. The review panel's Remove button remains available for touch and keyboard use.

The **Width** control adjusts the lesson body by 80 px, or 240 px with Shift-click. **Ctrl+Alt+Left/Right** narrows/widens it; **Ctrl+Alt+Down** resets. Width is saved on the current device, bounded by the viewport, and kept separate from shared lesson data. The two-column lesson uses a 760 px minimum on larger screens. This follows the behavior of [claude-wide-column](https://github.com/Ademord/claude-wide-column).

With my teacher creates a server-backed room and a private teacher invitation. The Site is public; shared rooms require ChatGPT sign-in. Teacher invitations survive sign-in within the same browser tab. One signed-in teacher can claim an invitation; the learner can replace it or end sharing. The server checks identity and role on every operation. Learner and teacher navigate independently, with an optional Follow learner control. The original local lesson remains available.

Each client sends field-level edits and polls for revisions about once per second. D1 is authoritative for shared rooms. Operation IDs make retries idempotent; compare-and-set edits preserve conflicts instead of overwriting writing. Pending edits remain in the local session and its full export. The interface reports connection or storage failures. This is HTTP polling, not WebSocket synchronization. The host does not currently expose a supported Durable Objects binding. The interactive guide at `dist/architecture.html` explains the choice and alternatives.

Notebook now offers a **full session JSON** backup: teaching content, drafts, legacy notes, conversation notes, saved phrases, teacher notes, pronunciation anchors, practice ticks, answers, tones, reveals and page positions. `sprachraum.session` version 1 wraps an unchanged `sprachraum.lesson` packet. Runtime page IDs are mapped to portable page IDs. Restore creates a separate session so existing notebooks are not replaced. Live invitation credentials and account IDs are excluded. Plain lesson-only JSON is still supported.

## Product structure

The opening screen asks for one topic and prepares a comprehensive prompt for an external AI agent, automatically attempting to copy it during the submit gesture. Clipboard denial shows a selected manual-copy field; prompt download is also available. A prepared example still opens immediately. Six horizontal areas stay available: Reading, Vocabulary, Grammar, Expression, Speaking, Writing. Each area contains a short numbered sequence. Teachers can jump freely and learners keep drafts when they change areas.

Expression contains three distinct operations: interpreting and restating an intention, comparing tone/register, and using phrases. Redemittel are useful conversational patterns; Redewendungen are figurative expressions. These are activities inside Expression rather than separate top-level destinations.

There are 52 original activities across three prepared topics: releases and announcements, checking in after a difficult day, and expressing interest with a boundary. Each includes an eight-paragraph reading (752, 777, and 774 words respectively), four text-grounded interpretation questions, a countertext with competing perspectives, contextual vocabulary, advanced grammar, register work, role-play, and a 250–320-word writing/revision assignment. New topics use the external-agent prompt/import workflow. There is no in-app AI call or AI scoring. Free writing is discussed with a teacher; only a closed question has automatic answer-key feedback.

## Lesson authoring and interchange

The request screen supports C1/C2 and optional context. Its self-contained prompt includes teaching requirements and the exact JSON schema, with sustained readings, paragraph-grounded analysis, contextual language work, speaking, writing, and revision. Starting a new topic clears the previous request's context; Continue creating retains it. Prompts never automatically include notebook content.

Paste the agent's JSON or choose a file (maximum 1 MB UTF-8), check the activity preview, then add the lesson. Format `sprachraum.lesson`, version `1`, contains lesson metadata and all six area arrays. The importer checks field types, lengths, tuples, answer keys, paragraph references, unique safe IDs, and backward draft references before changing the library. Content quality and factual accuracy remain for the teacher to review. Short-reading and missing-revision warnings are shown separately from structural errors. Invalid packets have an optional repair prompt.

Imported lessons load before session restoration and receive local namespaced IDs. Re-importing identical content opens its existing session; changed content gets a separate lesson. Local storage errors retain a usable session with an explicit backup notice. Damaged stored libraries are not silently overwritten. Lesson JSON exports contain teaching content; notebook exports contain learner notes. Both imported lessons and all three built-in examples can be exported from My lessons. The legacy editable workspace remains available through the existing start_lesson agent action.

The longer readings use paragraph references. Their sidebar stays beside the text on larger screens. Writing tasks display a live word count. Updated activities have stable revision IDs; earlier drafts remain in Notebook as earlier activities and cannot silently become answers to the new prompts.

## Source research

Both supplied archives were fully extracted: C1.1 has 50 PDFs and 1,486 pages; C1.2 has 50 PDFs and 1,492 pages. All 2,978 pages produced text, with no extraction failures. Cover categories: 36 Lesen, 36 Sprechen, 12 Grammatik, 12 Kommunikation, 4 Schreiben. Vocabulary and pragmatic expression are recurring strands within those categories.

The local sibling folder `../learning-source-analysis/` contains original PDFs, page-numbered TXT and JSON, inventory, hashes, source evidence, and six rendered sample pages. Those original PDFs, raw extraction, and the supplied private conversation are not hosted. `dist/lessons.js` carries the specific activity-pattern references shown in the interface. New examples are not represented as copied PDF exercises or as validated C1 assessment material.

## Verification

The September 2026 performance fix removes whole-passage reconstruction on unchanged updates and eliminates backup exports/localStorage writes during idle polling. Unsent field edits coalesce safely, retries retain immutable operation IDs, pending operation projection copies only changed fields, and idle database reads omit content blobs. Regression checks cover these costs, active selection and click preservation, and local writing during remote updates. A native local-browser check exercised successive marks and removal without console warnings or errors. See [the investigation and remaining limits](docs/performance-investigation.md); production-scale load and CPU tracing were not performed.

Revision 4: `npm test` includes the earlier checks plus full backup round trips, real DOM Range/Selection offset checks using jsdom, exact repeated-word/Unicode anchors, hidden/revealed marks, separate restore, two isolated DOM clients sharing the actual API with a SQLite D1 adapter, offline pending-state reload, concurrent edits, idempotent retry, preserved/resolved conflicts, invitation revocation, and request-size-bounded queue draining. UI selection was checked through jsdom, not a native browser or visual screenshot test. The server build is also checked. Production authorization uses the Site's forwarded authenticated-user headers; tests use synthetic identities.

The pronunciation redesign adds DOM regression checks for direct marking, phrase snapping, duplicate focus, undo, touch scrolling and native selections, keyboard phrase marking across paragraphs, focus retention, read/review transitions, remote deletion and stale selections after navigation. Native mobile keyboard and viewport behavior has not been browser-tested.

Revision 3: `node scripts/test-import.mjs` covers all three built-in export/import round trips and 52 imported page renderings, invalid packets, unsafe content, persistence and reload, revision drafts, duplicate/version isolation, paste-preview-import, clipboard success/fallback, quota failures, and damaged storage. `node scripts/validate-content.mjs` still passes the original content and draft checks. These are runtime checks with a DOM stub, not a browser layout or permission test. No new browser UI testing was performed for this revision.

Revision 2: `node scripts/build-content.mjs` produces the static advanced lessons from the authoring packets. `node scripts/validate-content.mjs` checks all 52 activity renderings in a lightweight DOM stub, paragraph-reference bounds, source references, minimum reading length, asset references, preserved earlier drafts, reuse of the revised writing task, and escaped learner input. JavaScript syntax checks pass. An independent content review checked the three essays, paragraph mappings, and grammar explanations; its five concrete corrections were applied. No new browser UI testing was performed for this revision.

Eight source readings were sampled in detail: 460–957 words, median 624. The separate `../learning-source-analysis/reading-length-benchmark.md` records exact PDFs, page ranges and counting method. This is a source comparison, not a CEFR length requirement. The supplied archives are C1.1/C1.2; the more demanding extension tasks are original and have not been independently level-certified.

Previous revision only:

JavaScript syntax and all local asset references checked. Browser checks exercised all 38 activity pages, six narrow-layout activity types, answer-specific wrong/correct feedback, page/tab changes, draft reuse, notebook saving, conversation notes, local reload/resume, and the editable workspace. WebMCP registration, normal navigation, state read-back, and invalid topic/page inputs were checked in the supported browser.

The browser viewport control clamped the requested 390-pixel test to 520 CSS pixels; narrow-layout verification was at the observed 520-pixel width. Exact 390-pixel rendering and full accessibility conformance were not tested.

## Files

- `dist/index.html`: entry point and metadata.
- `dist/style.css`: responsive interface.
- `dist/lessons.js`: prepared activities and PDF-pattern references.
- `content/*-advanced.json`: original advanced lesson drafts.
- `scripts/build-content.mjs`: reviewed adaptation of those drafts into activity records.
- `dist/advanced-lessons.js`: generated advanced activities; edit the authoring inputs and rebuild.
- `scripts/validate-content.mjs`: content, rendering and draft-preservation checks.
- `dist/app.js`: view rendering, navigation, local notes, export, and progressive WebMCP integration.
- `dist/lesson-format.js`: versioned schema, strict validation, normalization, portable export, and agent prompt.
- `dist/lesson-library.js`: imported lesson storage, restoration, and duplicate handling.
- `dist/lesson-authoring.js`, `dist/authoring.css`: prompt, clipboard, file import, preview, and repair workflow.
- `scripts/test-import.mjs`: import and authoring regression checks.
- `dist/session-format.js`: portable session state, anchor validation and shared edit semantics.
- `dist/collaboration.js`, `dist/room-client.js`, `dist/collaboration.css`: teacher/learner views, backups and live synchronization.
- `server/worker.js`: authenticated room API and durable compare-and-set edits.
- `db/schema.ts`, `drizzle/`: database schema and generated migrations.
- `scripts/test-collaboration.mjs`: DOM, API, concurrency, persistence and backup tests.
- `docs/collaboration-plan.md`: dependency graph and acceptance checks.
- `dist/architecture.html`: architecture explanation and timing demonstration.
- `.openai/hosting.json`: existing Site identity and logical D1 binding.
