import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

// Measure DOM work, not machine-dependent elapsed time. These assertions catch
// paragraph replacement, roving-tabindex churn, and selection/render feedback.
const dom = new JSDOM('<div id="app"></div><div id="toast"></div>', {
  url: 'https://sprachraum.test/', runScripts: 'outside-only', pretendToBeVisual: true
});
const w = dom.window, d = w.document;
const run = code => vm.runInContext(code, dom.getInternalVMContext());
Object.defineProperty(w, 'crypto', { value: webcrypto });
w.TextEncoder = TextEncoder;
w.scrollTo = () => {};
w.HTMLElement.prototype.scrollIntoView = () => {};
const settle = async () => {
  await new Promise(resolve => w.setTimeout(resolve, 0));
  await new Promise(resolve => w.requestAnimationFrame(resolve));
  await new Promise(resolve => w.requestAnimationFrame(resolve));
};
const q = selector => d.querySelector(selector);
const blocks = () => [...d.querySelectorAll('.material [data-annotatable]')];
const words = block => [...block.querySelectorAll('[data-pron-word]')];
const snapshot = () => blocks().map(block => ({ block, words: words(block), children: [...block.childNodes] }));
const replaced = previous => previous.flatMap((entry, index) => {
  const current = [...entry.block.childNodes];
  return current.length !== entry.children.length || current.some((node, i) => node !== entry.children[i]) ? [index] : [];
});
function assertUnchanged(previous, allowed = []) {
  const fresh = blocks();
  previous.forEach((entry, index) => {
    assert.equal(fresh[index], entry.block, 'an update retains the passage container');
    if (allowed.includes(index)) return;
    const currentChildren = [...entry.block.childNodes], currentWords = words(entry.block);
    assert.equal(currentChildren.length, entry.children.length, `paragraph ${index + 1} retains its child count`);
    currentChildren.forEach((node, i) => assert.equal(node, entry.children[i], `paragraph ${index + 1} retains child node ${i}`));
    assert.equal(currentWords.length, entry.words.length, `paragraph ${index + 1} retains its word count`);
    currentWords.forEach((node, i) => assert.equal(node, entry.words[i], `paragraph ${index + 1} retains word target ${i}`));
  });
}
let mutations = [];
let observer;
try {
  for (const file of ['lessons.js', 'advanced-lessons.js', 'lesson-format.js', 'session-format.js', 'lesson-library.js', 'lesson-authoring.js', 'room-client.js', 'lesson-width.js', 'pronunciation.js', 'collaboration.js', 'app.js']) {
    run(fs.readFileSync('dist/' + file, 'utf8'));
  }
  run("start('releases');state.presentation.role='teacher';render()");
  q('[data-pron-mode]').click();
  await settle();
  assert(blocks().length >= 3, 'use the full multi-paragraph C1 reading');
  const wordCount = d.querySelectorAll('.material [data-pron-word]').length;
  assert(wordCount >= 700, 'performance fixture retains the long reading');

  observer = new w.MutationObserver(records => mutations.push(...records));
  observer.observe(q('.material'), { subtree: true, childList: true, attributes: true, characterData: true });
  const initial = snapshot();
  for (let i = 0; i < 20; i++) w.PRONUNCIATION.paint();
  await settle();
  assertUnchanged(initial);
  assert.equal(mutations.length, 0, '20 unchanged paints produce zero material DOM mutations');

  // A collapsed selection event, including one raised by the browser after an
  // earlier paint, must not restart passage rendering or re-read lesson data.
  let sourceReads = 0;
  const originalSourceFor = w.COLLAB.sourceFor;
  w.COLLAB.sourceFor = (...args) => { sourceReads++; return originalSourceFor(...args); };
  for (let i = 0; i < 20; i++) d.dispatchEvent(new w.Event('selectionchange'));
  await settle();
  assertUnchanged(initial);
  assert.equal(mutations.length, 0, 'selectionchange alone produces no material mutations');
  assert.equal(sourceReads, 0, 'selectionchange alone does not recompute passage rendering');
  w.COLLAB.sourceFor = originalSourceFor;

  mutations = [];
  words(blocks()[0])[1].click();
  await settle();
  assert.equal(run('state.annotations.length'), 1);
  assertUnchanged(initial, [0]);
  const firstReplaced = replaced(initial);
  assert(firstReplaced.every(index => index === 0), 'first mark updates only its paragraph');
  const firstId = run('state.annotations[0].id');
  assert(q(`[data-mark="${firstId}"].active-mark`), 'new mark is active in the passage');
  assert.equal(q('[data-focus-id]').dataset.focusId, firstId);

  const afterFirst = snapshot();
  words(blocks()[1])[1].click();
  await settle();
  assert.equal(run('state.annotations.length'), 2);
  assertUnchanged(afterFirst, [0, 1]);
  const secondReplaced = replaced(afterFirst);
  assert(secondReplaced.every(index => index === 0 || index === 1), 'next mark only changes its paragraph and the previous active mark');
  const secondId = run('state.annotations[1].id');
  assert(!q(`[data-mark="${firstId}"].active-mark`), 'previous mark loses the active state');
  assert(q(`[data-mark="${secondId}"].active-mark`), 'second mark becomes active');
  assert.equal(q('[data-focus-id]').dataset.focusId, secondId);

  // Incoming feedback must leave an in-progress native selection intact. It
  // should paint exactly once that selection is cleared, without another edit.
  const selected = words(blocks()[0])[4];
  const range = d.createRange();
  range.selectNodeContents(selected);
  w.getSelection().removeAllRanges();
  w.getSelection().addRange(range);
  d.dispatchEvent(new w.Event('selectionchange'));
  await settle();
  const duringSelection = snapshot();
  const remoteWord = words(blocks()[2])[2], remoteId = webcrypto.randomUUID();
  w.remoteMark = {
    id: remoteId, pageId: blocks()[2].dataset.pageId, block: blocks()[2].dataset.block,
    start: Number(remoteWord.dataset.start), end: Number(remoteWord.dataset.end),
    quote: remoteWord.textContent, note: 'Remote teacher feedback.'
  };
  run('state.annotations.push(remoteMark)');
  mutations = [];
  w.PRONUNCIATION.paint();
  await settle();
  assertUnchanged(duringSelection);
  assert.equal(mutations.length, 0, 'incoming mark does not mutate selected passage nodes');
  assert.equal(w.getSelection().toString(), selected.textContent, 'native selection is preserved');
  assert(!q(`[data-mark="${remoteId}"]`), 'incoming mark waits for selection to finish');
  w.getSelection().removeAllRanges();
  d.dispatchEvent(new w.Event('selectionchange'));
  await settle();
  assert(q(`[data-mark="${remoteId}"]`), 'clearing selection releases the pending paint');
  assertUnchanged(duringSelection, [2]);
  assert.equal(d.querySelectorAll('.material [data-pron-word][tabindex="0"]').length, 1);

  mutations = [];
  const settled = snapshot();
  for (let i = 0; i < 20; i++) {
    w.PRONUNCIATION.paint();
    d.dispatchEvent(new w.Event('selectionchange'));
  }
  await settle();
  assertUnchanged(settled);
  assert.equal(mutations.length, 0, 'settled marks remain mutation-free across paints and selection events');

  // Reusing identical selection text must still replace its positional anchor.
  // Moving native selection handles can select a later occurrence without an
  // intervening collapsed selection or different preview text.
  const occurrences = new Map();
  for (const word of blocks().flatMap(words).filter(word => !word.closest('[data-mark]'))) {
    const group = occurrences.get(word.textContent) || [];
    group.push(word); occurrences.set(word.textContent, group);
  }
  const identical = [...occurrences.values()].find(group => group.length > 1);
  assert(identical, 'reading contains repeated words for the selection-anchor regression');
  const [earlier, later] = identical;
  const laterBlock = later.closest('[data-annotatable]');
  const expectedSelection = { pageId: laterBlock.dataset.pageId, block: laterBlock.dataset.block, start: Number(later.dataset.start), end: Number(later.dataset.end) };
  w.getSelection().setBaseAndExtent(earlier.firstChild, 0, earlier.firstChild, earlier.textContent.length);
  d.dispatchEvent(new w.Event('selectionchange'));
  const selectionButton = q('[data-pron-add-selection]');
  assert(selectionButton);
  w.getSelection().setBaseAndExtent(later.firstChild, 0, later.firstChild, later.textContent.length);
  d.dispatchEvent(new w.Event('selectionchange'));
  assert.equal(q('[data-pron-add-selection]'), selectionButton, 'identical preview reuses its DOM');
  selectionButton.click();
  await settle();
  const selectionMark = JSON.parse(run('JSON.stringify(state.annotations.at(-1))'));
  for (const field of Object.keys(expectedSelection)) assert.equal(selectionMark[field], expectedSelection[field], `reused selection preview keeps the latest ${field}`);

  // A network response can arrive between pointerdown and click. Deferring its
  // paint only until pointerup is insufficient: replacing the target then loses
  // the browser's subsequent click, so the user's local mark never gets added.
  const gestureBlock = blocks().find(block => words(block).filter(word => !word.closest('[data-mark]')).length >= 2);
  const [clickTarget, incomingTarget] = words(gestureBlock).filter(word => !word.closest('[data-mark]'));
  const clickAnchor = { pageId: gestureBlock.dataset.pageId, block: gestureBlock.dataset.block, start: Number(clickTarget.dataset.start), end: Number(clickTarget.dataset.end) };
  const pointer = type => {
    const event = new w.Event(type, { bubbles: true });
    Object.assign(event, { clientX: 20, clientY: 20, pointerType: 'mouse' });
    clickTarget.dispatchEvent(event);
  };
  pointer('pointerdown');
  w.gestureRemoteMark = {
    id: webcrypto.randomUUID(), pageId: gestureBlock.dataset.pageId, block: gestureBlock.dataset.block,
    start: Number(incomingTarget.dataset.start), end: Number(incomingTarget.dataset.end),
    quote: incomingTarget.textContent, note: 'Feedback arriving during a click.'
  };
  run('state.annotations.push(gestureRemoteMark)');
  w.PRONUNCIATION.paint();
  pointer('pointerup');
  assert(clickTarget.isConnected, 'pointerup preserves the target until its click is dispatched');
  clickTarget.click();
  await settle();
  const finalMarks = JSON.parse(run('JSON.stringify(state.annotations)'));
  assert(finalMarks.some(mark => Object.keys(clickAnchor).every(field => mark[field] === clickAnchor[field])), 'local click survives a deferred remote paint');
  assert(q(`[data-mark="${w.gestureRemoteMark.id}"]`), 'concurrent incoming mark is eventually painted');
  console.log(JSON.stringify({
    pronunciationPerformance: {
      wordCount, unchangedPaints: 20, unchangedMaterialMutations: 0,
      selectionEvents: 20, selectionOnlySourceReads: sourceReads,
      firstMarkParagraphsReplaced: firstReplaced.length,
      nextMarkParagraphsReplaced: secondReplaced.length,
      deferredMark: 'preserves selection and paints on clear',
      repeatedSelection: 'same preview retains current occurrence offsets',
      concurrentClick: 'remote repaint waits until the local click completes'
    }
  }, null, 2));
} finally {
  observer?.disconnect();
  w.COLLAB?.beforeLeave();
  w.close();
}
