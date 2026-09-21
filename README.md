# Sprachraum

A separate prototype for a teacher and learner working through German on one screen or via screen share.

Open `dist/index.html` or serve `dist/` with any static HTTP server. No installation or API key is needed. Assets are plain HTML, CSS and JavaScript. Fonts load from Google Fonts with local sans-serif fallbacks.

## Product structure

The opening screen asks for one topic. A prepared topic opens its most relevant activity immediately. Six horizontal areas stay available: Reading, Vocabulary, Grammar, Expression, Speaking, Writing. Each area contains a short numbered sequence. Teachers can jump freely and learners keep drafts when they change areas.

Expression contains three distinct operations: interpreting and restating an intention, comparing tone/register, and using phrases. Redemittel are useful conversational patterns; Redewendungen are figurative expressions. These are activities inside Expression rather than separate top-level destinations.

There are 38 original activities across three prepared topics: releases and announcements, checking in after a difficult day, and expressing interest with a boundary. Other topics open an editable workspace. Matching prepared examples is deterministic and does not generate content. There is no AI scoring, live teacher connection, or cross-device synchronization. Notes and page positions are explicitly local to the current browser. Free writing is discussed with a teacher; only a closed question has automatic answer-key feedback.

## Source research

Both supplied archives were fully extracted: C1.1 has 50 PDFs and 1,486 pages; C1.2 has 50 PDFs and 1,492 pages. All 2,978 pages produced text, with no extraction failures. Cover categories: 36 Lesen, 36 Sprechen, 12 Grammatik, 12 Kommunikation, 4 Schreiben. Vocabulary and pragmatic expression are recurring strands within those categories.

The local sibling folder `../learning-source-analysis/` contains original PDFs, page-numbered TXT and JSON, inventory, hashes, source evidence, and six rendered sample pages. Those original PDFs, raw extraction, and the supplied private conversation are not hosted. `dist/lessons.js` carries the specific activity-pattern references shown in the interface. New examples are not represented as copied PDF exercises or as validated C1 assessment material.

## Verification

JavaScript syntax and all local asset references checked. Browser checks exercised all 38 activity pages, six narrow-layout activity types, answer-specific wrong/correct feedback, page/tab changes, draft reuse, notebook saving, conversation notes, local reload/resume, and the editable workspace. WebMCP registration, normal navigation, state read-back, and invalid topic/page inputs were checked in the supported browser.

The browser viewport control clamped the requested 390-pixel test to 520 CSS pixels; narrow-layout verification was at the observed 520-pixel width. Exact 390-pixel rendering and full accessibility conformance were not tested.

## Files

- `dist/index.html`: entry point and metadata.
- `dist/style.css`: responsive interface.
- `dist/lessons.js`: prepared activities and PDF-pattern references.
- `dist/app.js`: view rendering, navigation, local notes, export, and progressive WebMCP integration.
- `.openai/hosting.json`: private Site identity and static output configuration.
