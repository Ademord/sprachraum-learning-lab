# Sprachraum

A separate prototype for a teacher and learner working through German on one screen or via screen share.

Open `dist/index.html` or serve `dist/` with any static HTTP server. No installation or API key is needed. Assets are plain HTML, CSS and JavaScript. Fonts load from Google Fonts with local sans-serif fallbacks.

## Product structure

The opening screen asks for one topic. A prepared topic opens its most relevant activity immediately. Six horizontal areas stay available: Reading, Vocabulary, Grammar, Expression, Speaking, Writing. Each area contains a short numbered sequence. Teachers can jump freely and learners keep drafts when they change areas.

Expression contains three distinct operations: interpreting and restating an intention, comparing tone/register, and using phrases. Redemittel are useful conversational patterns; Redewendungen are figurative expressions. These are activities inside Expression rather than separate top-level destinations.

There are 52 original activities across three prepared topics: releases and announcements, checking in after a difficult day, and expressing interest with a boundary. Each now includes an eight-paragraph reading (752, 777, and 774 words respectively), four text-grounded interpretation questions, a countertext with competing perspectives, contextual vocabulary, advanced grammar, register work, role-play, and a 250–320-word writing/revision assignment. Other topics open an editable workspace. Matching prepared examples is deterministic and does not generate content. There is no AI scoring, live teacher connection, or cross-device synchronization. Notes and page positions are explicitly local to the current browser. Free writing is discussed with a teacher; only a closed question has automatic answer-key feedback.

The longer readings use paragraph references. Their sidebar stays beside the text on larger screens. Writing tasks display a live word count. Updated activities have stable revision IDs; earlier drafts remain in Notebook as earlier activities and cannot silently become answers to the new prompts.

## Source research

Both supplied archives were fully extracted: C1.1 has 50 PDFs and 1,486 pages; C1.2 has 50 PDFs and 1,492 pages. All 2,978 pages produced text, with no extraction failures. Cover categories: 36 Lesen, 36 Sprechen, 12 Grammatik, 12 Kommunikation, 4 Schreiben. Vocabulary and pragmatic expression are recurring strands within those categories.

The local sibling folder `../learning-source-analysis/` contains original PDFs, page-numbered TXT and JSON, inventory, hashes, source evidence, and six rendered sample pages. Those original PDFs, raw extraction, and the supplied private conversation are not hosted. `dist/lessons.js` carries the specific activity-pattern references shown in the interface. New examples are not represented as copied PDF exercises or as validated C1 assessment material.

## Verification

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
- `.openai/hosting.json`: private Site identity and static output configuration.
