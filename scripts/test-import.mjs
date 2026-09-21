import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

function boot(stored = new Map(), { quota = false, clipboard = true } = {}) {
  const elements = new Map(), downloads = [], copied = [], tools = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { innerHTML: '', textContent: '', value: '', style: {}, classList: { add() {}, remove() {} }, firstElementChild: { inert: false }, focus() {}, select() { this.selected = true; }, remove() {}, getBoundingClientRect() { return { top: 0 }; }, scrollIntoView() {}, addEventListener() {}, insertAdjacentHTML(_, html) { this.innerHTML += html; } });
    return elements.get(selector);
  };
  const context = { TextEncoder, crypto: webcrypto, Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    document: { querySelector: element, querySelectorAll: () => [], addEventListener() {}, body: { style: {} }, createElement: () => ({ click() { downloads.push(this.download); } }), modelContext: { registerTool: d => tools.push(d) } },
    navigator: { clipboard: { writeText: async text => { if (!clipboard) throw new Error('denied'); copied.push(text); } } },
    localStorage: { getItem: k => stored.get(k), setItem(k, v) { if (quota) throw new Error('quota'); stored.set(k, v); } },
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, AbortController, console };
  context.window = context; vm.createContext(context);
  for (const file of ['lessons.js', 'advanced-lessons.js', 'lesson-format.js', 'session-format.js', 'lesson-library.js', 'lesson-authoring.js', 'room-client.js', 'lesson-width.js','pronunciation.js', 'collaboration.js', 'app.js']) vm.runInContext(fs.readFileSync(`dist/${file}`, 'utf8')+(file==='pronunciation.js'?'\nPRONUNCIATION.mount=()=>{};':file==='lesson-width.js'?'\nLESSON_WIDTH.mount=()=>{};':''), context, { filename: file });
  return { context, stored, elements, downloads, copied, tools, run: code => vm.runInContext(code, context), element };
}
const a = boot();
const io = a.context.LESSON_IO;
const packets = Object.entries(a.context.LESSONS).map(([id, lesson]) => {
  const packet = io.fromLesson(lesson), checked = io.validate(packet);
  assert(checked.ok, `${id}: ${checked.errors.join('\n')}`);
  assert(checked.summary.readingWords > 700);
  const normalized = io.normalize(packet, 'imported-test-1234');
  assert(io.validate(io.fromLesson(normalized)).ok, 'normalized lesson export remains portable');
  return packet;
});
const original = packets[0];
const raw = JSON.stringify(original);
const invalid = [];
function reject(name, mutate) {
  const broken = structuredClone(original); mutate(broken);
  const snapshot = JSON.stringify([...a.stored]);
  const count = a.context.LESSON_LIBRARY.size;
  const result = a.context.LESSON_LIBRARY.add(broken);
  assert(!result.ok, name); assert(result.errors.length, name);
  assert.equal(a.context.LESSON_LIBRARY.size, count, name + ' leaves library unchanged');
  assert.equal(JSON.stringify([...a.stored]), snapshot, name + ' leaves storage unchanged');
  invalid.push(name);
}
reject('missing area', p => delete p.lesson.areas.grammar);
reject('wrong tuple length', p => p.lesson.areas.vocabulary[0].words[0].pop());
reject('duplicate page IDs', p => p.lesson.areas.reading[1].id = p.lesson.areas.reading[0].id);
reject('missing paragraph target', p => p.lesson.areas.reading[1].referenceId = 'missing-text');
reject('out-of-range paragraph', p => p.lesson.areas.reading[1].tasks[0].paragraphs = [29]);
reject('future revision reference', p => p.lesson.areas.writing[0].reuse = p.lesson.areas.writing[1].id);
reject('missing revision reference', p => p.lesson.areas.writing[1].reuse = 'missing-draft');
reject('unsupported language', p => { const pg = p.lesson.areas.reading[0]; pg.lang = 'de" onclick="bad'; });
reject('unsupported property', p => p.lesson.html = '<script>x</script>');
reject('invalid answer index', p => p.lesson.areas.reading[0].check = { options: ['A', 'B'], correct: 3, feedback: ['a', 'b'] });
reject('feedback count', p => p.lesson.areas.reading[0].check = { options: ['A', 'B'], correct: 1, feedback: ['a', 'b', 'c'] });
reject('unsafe tone ID', p => p.lesson.areas.expression.find(pg => pg.kind === 'tone').tones[0][0] = '"]bad');
reject('invisible reading source', p => { p.lesson.areas.reading[0].kind = 'words'; p.lesson.areas.reading[0].words = [['a', 'b', 'c']]; });
reject('reverse target range', p => p.lesson.areas.writing[0].targetWords = '320–250');
assert(!io.validate('{bad}').ok);
assert(!io.validate(raw.slice(0, -10)).ok);
assert(!io.validate('{"__proto__":{}}').ok);
assert(!io.validate('{"constructor":{}}').ok);
assert(!io.validate('ü'.repeat(600000)).ok);
assert(io.validate('```json\n' + raw + '\n```').ok);
assert(io.validate('\uFEFF' + raw).ok);

const added = a.context.LESSON_LIBRARY.add(original);
assert(added.ok && added.saved && !added.duplicate);
a.run(`start('Imported lesson', ${JSON.stringify(added.id)});navigate('writing',0);state.drafts[key()]='My original draft';persist();navigate('writing',1)`);
assert.match(a.run('material(pages()[pageIndex()])'), /My original draft/);
const firstKey = a.context.LESSONS[added.id].writing[0].id;
assert.match(a.run('material(pages()[pageIndex()])'), /My original draft/);
const duplicate = a.context.LESSON_LIBRARY.add(JSON.stringify({ lesson: original.lesson, version: 1, format: 'sprachraum.lesson' }));
assert(duplicate.duplicate); assert.equal(duplicate.id, added.id);
const changed = structuredClone(original); changed.lesson.title += ' – revision';
const next = a.context.LESSON_LIBRARY.add(changed);
assert(next.ok && next.id !== added.id);
assert.equal(a.run(`sessions[${JSON.stringify(added.id)}].drafts[${JSON.stringify(firstKey)}]`), 'My original draft');
const b = boot(a.stored);
b.run(`start('Restored',${JSON.stringify(added.id)});navigate('writing',1)`);
assert.match(b.run('material(pages()[pageIndex()])'), /My original draft/);
assert(b.context.LESSON_LIBRARY.isSaved(added.id));
const unsafe = structuredClone(original);
unsafe.lesson.title = '<img src=x onerror=alert(1)>';
unsafe.lesson.areas.reading[0].paragraphs[0] = '<script>alert(1)</script> [[\" onclick=bad]]';
const safe = b.context.LESSON_LIBRARY.add(unsafe);
b.run(`start('Safety test',${JSON.stringify(safe.id)});navigate('reading',0)`);
const rendered = b.element('#app').innerHTML;
assert(!rendered.includes('<script>alert(1)'));
assert(!rendered.includes('<img src=x'));
assert(rendered.includes('&lt;script&gt;'));
assert(!rendered.includes('Originaltext für diese Lektion'));
b.run("openDrawer('source')"); assert(b.element('#app').innerHTML.includes('have not been independently verified'));

let renderedPages = 0;
for (const packet of packets) {
  const entry = a.context.LESSON_LIBRARY.add(packet);
  a.run(`start('Render all',${JSON.stringify(entry.id)})`);
  for (const area of io.areas) for (let i = 0; i < packet.lesson.areas[area].length; i++) {
    a.run(`navigate(${JSON.stringify(area)},${i})`);
    assert(!a.element('#app').innerHTML.includes('undefined'));
    assert(!a.element('#app').innerHTML.includes('NaN'));
    renderedPages++;
  }
}
const denied = boot(new Map(), { quota: true, clipboard: false });
denied.context.packet = original;
const temporary = denied.run('installImportedLesson(packet)');
assert(temporary.ok && !temporary.saved);
assert(denied.element('#app').innerHTML.includes('available for this visit only'));
assert.equal(denied.context.LESSON_LIBRARY.size, 1);
denied.run("authorLesson('Konflikte am Arbeitsplatz')");
await denied.run('copyPrompt()');
assert.match(denied.element('#copy-status').textContent, /blocked/);
assert.equal(denied.element('#prompt-text').selected, true);
assert(denied.element('#prompt-text').value.length > 20000);

a.run("authorLesson('Konflikte am Arbeitsplatz')");
await a.run('copyPrompt()');
assert.equal(a.copied.length, 1);
assert.match(a.element('#copy-status').textContent, /Prompt copied/);
assert(a.copied[0].includes('Konflikte am Arbeitsplatz'));
assert(!a.copied[0].includes('My original draft'));
a.run("updateBrief()"); assert.match(a.element('#copy-status').textContent, /Copy the prompt again/);
// Exercise the paste → validation preview → add action, not just the library helper.
a.element('#import-json').oninput({ target: { value: JSON.stringify(packets[2]) } });
a.element('[data-check-import]').onclick();
assert(a.element('#import-result').innerHTML.includes('Format checked'));
a.element('[data-add-import]').onclick();
assert.equal(a.run('view'), 'session');
a.run("authorLesson(undefined,false,true)");
a.element('#import-json').oninput({ target: { value: '{broken' } });
a.element('[data-check-import]').onclick();
assert(a.element('#import-result').innerHTML.includes('needs a correction'));
await a.run('copyRepair()');
assert(a.copied.at(-1).includes('VALIDATION ERRORS'));
assert(a.copied.at(-1).includes('{broken'));
a.run('downloadLesson("release")'); assert(a.downloads.includes('sprachraum-lesson.json'));
const badStore = new Map([['sprachraum.lessons.v1', '{bad']]);
const recovered = boot(badStore); recovered.context.LESSON_LIBRARY.add(original);
assert.equal(badStore.get('sprachraum.lessons.v1'), '{bad');
assert(recovered.context.LESSON_LIBRARY.recoveryNotice);
assert(a.tools.find(t => t.name === 'read_lesson_state'));
// New requests never inherit a previous private context; continuing keeps it.
a.run("brief.context='Private earlier context';authorLesson();");
assert(a.run('brief.context').includes('Private'));
a.run("authorLesson('A new unrelated topic')");
await a.run('copyPrompt()');
assert(!a.copied.at(-1).includes('Private earlier context'));
// File import and stale reads share the same preview path as pasted JSON.
await a.run('readLessonFile')({ target: { files: [{ size: raw.length, text: async () => raw }], value: 'example.json' } });
assert(a.element('#import-result').innerHTML.includes('Format checked'));
await a.run('readLessonFile')({ target: { files: [{ size: 1600001 }], value: 'too-big.json' } });
assert(a.element('#import-result').innerHTML.includes('smaller than 1.6 MB'));
assert(!a.element('#import-result').innerHTML.includes('data-copy-repair'));
let failSlowRead;
const slowRead = a.run('readLessonFile')({ target: { files: [{ size: 100, text: () => new Promise((resolve, reject) => { failSlowRead = reject; }) }], value: 'slow.json' } });
a.element('#import-json').oninput({ target: { value: raw } }); a.run('checkImport()');
failSlowRead(new Error('old failure')); await slowRead;
assert(a.element('#import-result').innerHTML.includes('Format checked'));
const createTool = a.tools.find(t => t.name === 'create_lesson_prompt');
assert(createTool.execute({ topic: 'Argumentieren', level: 'C2' }).prompt.includes('Argumentieren'));
assert.throws(() => createTool.execute({ topic: '', level: 'C2' }));
const checkTool = a.tools.find(t => t.name === 'validate_lesson_json');
const beforeTools = a.context.LESSON_LIBRARY.size;
assert(checkTool.execute({ json: raw }).ok);
assert.equal(a.context.LESSON_LIBRARY.size, beforeTools);
assert(a.tools.find(t => t.name === 'import_lesson_json').execute({ json: raw }).alreadyInLibrary);
console.log(JSON.stringify({ builtInRoundTrips: packets.length, importedPagesRendered: renderedPages, rejectedCases: invalid.length + 5, draftReloadAndRevision: 'passed', duplicateAndUpdatedLessonIsolation: 'passed', pastePreviewImport: 'passed', clipboardSuccessAndFallback: 'passed', quotaAndDamagedStorage: 'passed', escapedImportedContent: 'passed', promptCharacters: a.copied[0].length }, null, 2));
