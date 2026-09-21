import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="app"></div><div id="toast"></div>', { url: 'https://sprachraum.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window, d = w.document, run = code => vm.runInContext(code, dom.getInternalVMContext());
Object.defineProperty(w, 'crypto', { value: webcrypto }); w.TextEncoder = TextEncoder; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
for (const file of ['lessons.js','advanced-lessons.js','lesson-format.js','session-format.js','lesson-library.js','lesson-authoring.js','room-client.js','lesson-width.js','pronunciation.js','collaboration.js','app.js']) run(fs.readFileSync('dist/' + file, 'utf8'));
run("start('releases');state.presentation.role='teacher';render()");
const source = 'Äpfel 🥣 und Äpfel: heute sprechen wir miteinander. Noch ein Satz.';
run(`LESSONS.release.reading[0].paragraphs[0]=${JSON.stringify(source)};render()`);
w.document.querySelector('[data-pron-mode]').click();
const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
const first = () => q('[data-annotatable]');
const word = (text, occurrence = 0) => [...first().querySelectorAll('[data-pron-word]')].filter(el => el.textContent === text)[occurrence];
const marks = () => JSON.parse(run('JSON.stringify(state.annotations)'));
const pointer = (el, type, values = {}) => { const e = new w.Event(type, { bubbles: true }); Object.assign(e, { clientX: 20, clientY: 20, pointerType: 'mouse', ...values }); el.dispatchEvent(e); };
const tap = (el, values) => { pointer(el, 'pointerdown', values); pointer(el, 'pointerup', values); el.click(); };
const key = (el, key, values = {}) => el.dispatchEvent(new w.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...values }));
function select(a, b = a, partial = false) { const range = d.createRange(); range.setStart(a.firstChild, partial ? 1 : 0); range.setEnd(b.firstChild, partial ? b.textContent.length - 1 : b.textContent.length); w.getSelection().removeAllRanges(); w.getSelection().addRange(range); }

assert(q('.activity').hidden); assert(!q('[data-pron-rail]').hidden); assert(!q('.drawer')); assert(!q('.app-shell').inert);
assert.equal(qa('[data-pron-word][tabindex="0"]').length, 1);
tap(word('Äpfel', 1)); assert.equal(marks().length, 1); assert.equal(marks()[0].start, source.indexOf('Äpfel', 1));
assert.equal(q('[data-focus-id]').dataset.focusId, marks()[0].id); assert(!q('.selection-action'));
const hint = q('[data-mark-note]'); hint.focus(); hint.value = 'Ä: open vowel; stress the first syllable.'; hint.dispatchEvent(new w.Event('input'));
run('COLLAB.paintMarks()'); assert.equal(q('[data-mark-note]'), hint, 'remote refresh does not replace an active note field'); assert.equal(marks()[0].note, hint.value);
key(hint, 'z', { ctrlKey: true }); assert.equal(marks().length, 1, 'typing undo belongs to the text field'); hint.blur();
hint.focus(); q('[data-delete-mark]').focus(); await new Promise(resolve => setTimeout(resolve, 20));
assert(d.activeElement.matches('[data-delete-mark]'), 'leaving a note preserves keyboard focus on the next control');
tap(q('[data-mark]')); assert.equal(marks().length, 1, 'reopening a mark does not create a duplicate');

pointer(word('heute'), 'pointerdown'); select(word('heute'), word('sprechen'), true); pointer(word('sprechen'), 'pointerup', { clientX: 150 });
assert.equal(marks().length, 2); assert.equal(marks()[1].quote, 'heute sprechen', 'partial phrase selection snaps to complete words');
pointer(word('heute'), 'pointerdown'); select(word('heute'), word('sprechen')); pointer(word('sprechen'), 'pointerup', { clientX: 150 });
assert.equal(marks().length, 2, 'exact duplicate selection opens the existing mark');
assert.equal(q('[data-focus-id]').dataset.focusId, marks()[1].id);
tap(q('[data-delete-mark]')); assert.equal(marks().length, 1); tap(q('[data-pron-undo]')); assert.equal(marks().length, 2);

const scrolling = word('miteinander'); pointer(scrolling, 'pointerdown', { pointerType: 'touch' }); pointer(scrolling, 'pointerup', { pointerType: 'touch', clientY: 150 }); scrolling.click();
assert.equal(marks().length, 2, 'touch scrolling must not mark a word');
tap(word('miteinander'), { pointerType: 'touch' }); assert.equal(marks().length, 3);
pointer(word('Noch'), 'pointerdown', { pointerType: 'touch' }); select(word('Noch'), word('Satz')); pointer(word('Satz'), 'pointerup', { pointerType: 'touch' });
assert.equal(marks().length, 3, 'touch handles retain their native selection before confirmation');
d.dispatchEvent(new w.Event('selectionchange')); assert(!q('[data-pron-selection]').hidden);
tap(q('[data-pron-add-selection]')); assert.equal(marks().length, 4); assert.equal(marks()[3].quote, 'Noch ein Satz');
select(word('und')); d.dispatchEvent(new w.Event('selectionchange')); assert(!q('[data-pron-selection]').hidden);
w.getSelection().removeAllRanges(); d.dispatchEvent(new w.Event('selectionchange')); assert(q('[data-pron-selection]').hidden, 'collapsed selection clears its action');
select(word('und')); pointer(word('und'), 'pointerdown', { button: 2 }); pointer(word('und'), 'pointerup', { button: 2 });
assert.equal(marks().length, 4, 'right-clicking a selection does not mark it');
tap(q('[data-pron-mode]')); assert.equal(marks().length, 4, 'clicking outside the text does not commit an existing selection');
tap(q('[data-pron-mode]'));

const firstWord = word('Äpfel'); firstWord.focus(); key(firstWord, 'Enter'); assert.equal(marks().length, 5);
let focused = d.activeElement; assert.equal(focused.textContent, 'Äpfel'); key(focused, 'ArrowRight'); assert.equal(d.activeElement.textContent, 'und');
key(d.activeElement, 'ArrowRight', { shiftKey: true }); key(d.activeElement, 'Enter'); assert.equal(marks().length, 6); assert.equal(marks()[5].quote, 'und Äpfel');
assert.equal(qa('[data-pron-word][tabindex="0"]').length, 1);
key(d.activeElement, 'z', { ctrlKey: true }); assert.equal(marks().length, 5);
word('Satz').focus(); key(d.activeElement, 'ArrowRight', { shiftKey: true }); key(d.activeElement, 'Enter');
assert.equal(marks().length, 7, 'keyboard phrase across paragraphs creates precise anchors for both blocks');
key(d.activeElement, 'z', { ctrlKey: true }); assert.equal(marks().length, 5, 'one undo removes the multi-paragraph gesture');
tap(q('[data-pron-mode]')); assert(!q('.activity').hidden); assert(q('[data-pron-rail]').hidden); assert.equal(qa('[data-pron-word]').length, 0);
tap(q('[data-pron-mode]')); assert(q('.activity').hidden); assert(qa('[data-pron-word]').length);

run("state.presentation.role='learner';state.presentation.showMarks=false;render()"); assert.equal(qa('.material mark').length, 0);
tap(q('[data-pron-mode]')); assert(qa('.material mark').length); assert(!q('[data-mark-note]')); assert(!q('[data-delete-mark]'));
const learnerMark = q('.material mark'); learnerMark.focus(); key(learnerMark, 'Enter'); assert(q('.pron-focus'));
tap(q('[data-pron-practise]')); assert.equal(q('[data-pron-practise]').getAttribute('aria-pressed'), 'true');
tap(q('[data-pron-next]')); assert(q('.pron-focus'));
key(q('.material'), 'Escape'); assert.equal(qa('.material mark').length, 0); assert(!q('.activity').hidden);

run("state.presentation.role='teacher';render()"); tap(q('[data-pron-mode]')); tap(q('[data-mark]'));
const activeId = q('[data-focus-id]').dataset.focusId; q('[data-mark-note]').focus();
run(`state.annotations=state.annotations.filter(a=>a.id!==${JSON.stringify(activeId)});delete state.practiced[${JSON.stringify(activeId)}];COLLAB.paintMarks()`);
assert(!q(`[data-focus-id="${activeId}"]`), 'remote deletion removes the active note safely');
const beforeNavigation = marks().length; select(word('und')); run("navigate('reading',1)");
d.dispatchEvent(new w.Event('selectionchange')); pointer(q('.material'), 'pointerup'); assert.equal(marks().length, beforeNavigation); assert(!q('[data-pron-add-selection]'));
assert(w.COLLAB.backup().session.annotations.length === marks().length);

// The removal control is outside the text: selecting/exporting a passage never includes its ×.
run("navigate('reading',0)");
w.HTMLElement.prototype.getClientRects = function () { return this.matches('[data-mark]') ? [{ top: 200, right: 300, bottom: 225, left: 250, width: 50, height: 25 }] : []; };
const beforeRemovalText = first().textContent, chosenMark = q('.material [data-mark]');
chosenMark.dispatchEvent(new w.Event('pointerover', { bubbles: true }));
const removeButton = q('[data-pron-remove-floating]'); assert(removeButton && !removeButton.hidden);
const removedId = removeButton.dataset.markId, removedMark = marks().find(a => a.id === removedId);
assert.equal(removeButton.textContent, '×'); assert(!removeButton.closest('[data-annotatable]'));
tap(removeButton); assert(!marks().some(a => a.id === removedId)); assert.equal(first().textContent, beforeRemovalText);
tap(q('[data-pron-undo]')); assert.deepEqual(marks().find(a => a.id === removedId), removedMark);
run("state.presentation.role='learner';state.presentation.showMarks=true;render()"); assert(!q('[data-pron-remove-floating]') || q('[data-pron-remove-floating]').hidden);

// Width shortcuts must not also move the word cursor or enter the session backup.
run("state.presentation.role='teacher';render()"); tap(q('[data-pron-mode]'));
Object.defineProperty(w, 'innerWidth', { value: 1800, writable: true }); w.LESSON_WIDTH.mount();
word('und').focus(); const wordFocus = d.activeElement;
key(wordFocus, 'ArrowRight', { code: 'ArrowRight', ctrlKey: true, altKey: true });
assert.equal(d.documentElement.style.getPropertyValue('--lesson-width'), '1400px'); assert.equal(d.activeElement, wordFocus);
key(wordFocus, 'ArrowLeft', { code: 'ArrowLeft', ctrlKey: true, altKey: true }); assert.equal(q('[data-width-label]').textContent, '1320 px');
q('[data-width-wider]').dispatchEvent(new w.MouseEvent('click', { bubbles: true, shiftKey: true })); assert.equal(q('[data-width-label]').textContent, '1560 px');
assert.equal(JSON.parse(w.localStorage.getItem('sprachraum.lesson-width.v1')), 1560);
run('render()'); assert.equal(q('[data-width-label]').textContent, '1560 px');
w.innerWidth = 900; w.dispatchEvent(new w.Event('resize')); assert.equal(q('[data-width-label]').textContent, '900 px');
assert(q('[data-width-wider]').disabled); assert.equal(JSON.parse(w.localStorage.getItem('sprachraum.lesson-width.v1')), 1560);
w.innerWidth = 1800; w.dispatchEvent(new w.Event('resize')); assert.equal(q('[data-width-label]').textContent, '1560 px');
key(q('[data-width-reset]'), 'ArrowDown', { code: 'ArrowDown', ctrlKey: true, altKey: true });
assert.equal(w.localStorage.getItem('sprachraum.lesson-width.v1'), null); assert.equal(d.documentElement.style.getPropertyValue('--lesson-width'), '');
assert(q('[data-width-reset]').disabled); assert(!JSON.stringify(w.COLLAB.backup()).includes('lesson-width'));
dom.window.close();
console.log('Pronunciation: selection, review, inline removal/undo and exact anchors passed. Width: controls, keyboard isolation, saved preference, viewport clamp and reset passed.');
