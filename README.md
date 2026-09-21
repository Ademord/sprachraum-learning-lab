# Sprachraum

A separate prototype for a teacher and learner working through German on one screen or via screen share.

Open `dist/index.html` or serve `dist/` with any static HTTP server. No installation or API key is needed. Assets are plain HTML, CSS and JavaScript. Fonts load from Google Fonts with local sans-serif fallbacks.

## Product structure

The opening screen asks for one topic and prepares a comprehensive prompt for an external AI agent, automatically attempting to copy it during the submit gesture. Clipboard denial shows a selected manual-copy field; prompt download is also available. A prepared example still opens immediately. Six horizontal areas stay available: Reading, Vocabulary, Grammar, Expression, Speaking, Writing. Each area contains a short numbered sequence. Teachers can jump freely and learners keep drafts when they change areas.

Expression contains three distinct operations: interpreting and restating an intention, comparing tone/register, and using phrases. Redemittel are useful conversational patterns; Redewendungen are figurative expressions. These are activities inside Expression rather than separate top-level destinations.

There are 52 original activities across three prepared topics: releases and announcements, checking in after a difficult day, and expressing interest with a boundary. Each includes an eight-paragraph reading (752, 777, and 774 words respectively), four text-grounded interpretation questions, a countertext with competing perspectives, contextual vocabulary, advanced grammar, register work, role-play, and a 250–320-word writing/revision assignment. New topics use the external-agent prompt/import workflow. There is no in-app AI call, AI scoring, live teacher connection, or cross-device synchronization. Notes and page positions are local to the current browser. Free writing is discussed with a teacher; only a closed question has automatic answer-key feedback.

## Lesson authoring and interchange

The request screen supports C1/C2 and optional context. Its self-contained prompt includes teaching requirements and the exact JSON schema, with sustained readings, paragraph-grounded analysis, contextual language work, speaking, writing, and revision. Starting a new topic clears the previous request's context; Continue creating retains it. Prompts never automatically include notebook content.

Paste the agent's JSON or choose a file (maximum 1 MB UTF-8), check the activity preview, then add the lesson. Format `sprachraum.lesson`, version `1`, contains lesson metadata and all six area arrays. The importer checks field types, lengths, tuples, answer keys, paragraph references, unique safe IDs, and backward draft references before changing the library. Content quality and factual accuracy remain for the teacher to review. Short-reading and missing-revision warnings are shown separately from structural errors. Invalid packets have an optional repair prompt.

Imported lessons load before session restoration and receive local namespaced IDs. Re-importing identical content opens its existing session; changed content gets a separate lesson. Local storage errors retain a usable session with an explicit backup notice. Damaged stored libraries are not silently overwritten. Lesson JSON exports contain teaching content; notebook exports contain learner notes. Both imported lessons and all three built-in examples can be exported from My lessons. The legacy editable workspace remains available through the existing start_lesson agent action.

The longer readings use paragraph references. Their sidebar stays beside the text on larger screens. Writing tasks display a live word count. Updated activities have stable revision IDs; earlier drafts remain in Notebook as earlier activities and cannot silently become answers to the new prompts.

## Source research

Both supplied archives were fully extracted: C1.1 has 50 PDFs and 1,486 pages; C1.2 has 50 PDFs and 1,492 pages. All 2,978 pages produced text, with no extraction failures. Cover categories: 36 Lesen, 36 Sprechen, 12 Grammatik, 12 Kommunikation, 4 Schreiben. Vocabulary and pragmatic expression are recurring strands within those categories.

The local sibling folder `../learning-source-analysis/` contains original PDFs, page-numbered TXT and JSON, inventory, hashes, source evidence, and six rendered sample pages. Those original PDFs, raw extraction, and the supplied private conversation are not hosted. `dist/lessons.js` carries the specific activity-pattern references shown in the interface. New examples are not represented as copied PDF exercises or as validated C1 assessment material.

## Verification

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
- `.openai/hosting.json`: private Site identity and static output configuration.
