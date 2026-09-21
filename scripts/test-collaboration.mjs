import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { JSDOM } from 'jsdom';
import worker from '../server/worker.js';
import { localDB } from './local-db.mjs';
import '../dist/room-client.js';

const IO = globalThis.SESSION_IO, lessonIO = globalThis.LESSON_IO;
const fixtures = { window: {} }; fixtures.window = fixtures; vm.createContext(fixtures);
for (const name of ['lessons.js', 'advanced-lessons.js']) vm.runInContext(fs.readFileSync('dist/' + name, 'utf8'), fixtures);
const packet = lessonIO.fromLesson(fixtures.LESSONS.release);
const testPacket = structuredClone(packet);
testPacket.lesson.areas.reading[0].paragraphs[0] = 'Äpfel 🥣 und [[Äpfel]]: zwei gleiche Wörter, eine genaue Stelle.';
const firstPage = testPacket.lesson.areas.reading[0].id;
const phrase = IO.block(testPacket, firstPage, 'paragraphs:0');
const start = phrase.indexOf('Äpfel', 1);
const mark = { id: crypto.randomUUID(), pageId: firstPage, block: 'paragraphs:0', start, end: start + 5, quote: 'Äpfel', note: 'Kurzer Vokal, erste Silbe betonen.' };
const full = { format: 'sprachraum.session', version: 1, lesson: testPacket, session: { ...IO.empty('Food and expectations'), drafts: { [firstPage]: 'My draft' }, extraDrafts: { conversation: 'Our call notes', 'reading:0': 'Earlier version note' }, teacherNotes: 'Practise together.', annotations: [mark], practiced: { [mark.id]: true } } };
assert(IO.validate(full).ok);
assert.equal(IO.block(testPacket, firstPage, 'paragraphs:0').slice(mark.start, mark.end), mark.quote);
const bad = structuredClone(full); bad.session.annotations[0].start = 0; assert(!IO.validate(bad).ok);
assert.equal(IO.validate(bad).repairable, false);
for (const lesson of Object.values(fixtures.LESSONS)) {
  const exported = lessonIO.fromLesson(lesson), ids = IO.maps(lesson, exported);
  const runtimeState = { id: 'original', lesson: 'built-in', topic: lesson.title, tab: 'writing', pages: { writing: 1 }, drafts: { [lesson.writing[0].id]: 'A substantial learner draft.', conversation: 'Conversation', 'reading:0': 'Legacy note' }, tones: {}, checks: {}, reveals: {}, saved: [], annotations: [], practiced: {}, teacherNotes: 'Feedback' };
  const output = IO.exportState(runtimeState, lesson, exported);
  const loadedLesson = lessonIO.normalize(exported, 'imported-new-12345678');
  const restored = IO.importState(output.session, loadedLesson, exported, 'restored-new-12345678', 'imported-new-12345678');
  assert.equal(restored.drafts[loadedLesson.writing[0].id], 'A substantial learner draft.');
  assert.equal(restored.drafts['reading:0'], 'Legacy note');
  assert.deepEqual(IO.exportState(restored, loadedLesson, exported).session, output.session);
  assert(ids.toPortable.get(lesson.writing[0].id));
}

// Actual DOM Range/Selection implementation, without browser automation.
const dom = new JSDOM('<div id="app"></div><div id="toast"></div>', { url: 'https://sprachraum.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window; Object.defineProperty(w, 'crypto', { value: webcrypto });
const run = code => vm.runInContext(code, dom.getInternalVMContext());
w.TextEncoder = TextEncoder; w.scrollTo = () => {}; w.HTMLElement.prototype.scrollIntoView = () => {};
w.fetch = async () => new Response(JSON.stringify({ rooms: [] }), { headers: { 'Content-Type': 'application/json' } });
w.URL.createObjectURL = () => 'blob:test'; w.URL.revokeObjectURL = () => {};
for (const file of ['lessons.js','advanced-lessons.js','lesson-format.js','session-format.js','lesson-library.js','lesson-authoring.js','room-client.js','pronunciation.js','collaboration.js','app.js']) run(fs.readFileSync('dist/' + file, 'utf8'));
w.inputPacket = testPacket; run('installImportedLesson(inputPacket)');
const viewSelect = w.document.querySelector('[data-view]'); viewSelect.value = 'teacher'; viewSelect.dispatchEvent(new w.Event('change'));
const container = w.document.querySelector('[data-annotatable]');
const chosen = [...container.querySelectorAll('[data-pron-word]')].find(el => Number(el.dataset.start) === start);
const range = w.document.createRange(); range.selectNodeContents(chosen);
w.getSelection().removeAllRanges(); w.getSelection().addRange(range);
const anchor = w.COLLAB.selectionAnchor(w.getSelection()); assert.equal(anchor.start, start); assert.equal(anchor.quote, 'Äpfel');
container.dispatchEvent(new w.Event('pointerdown', { bubbles: true }));
container.dispatchEvent(new w.Event('pointerup', { bubbles: true }));
assert(!w.document.querySelector('.selection-action')); // Drag selection marks immediately.
assert.equal(run('state.annotations.length'), 1); assert.equal(w.document.querySelectorAll('.material mark').length, 1);
run("state.drafts[key()]='Typed during class';state.drafts['reading:0']='Earlier draft';persist();openDrawer('feedback')");
const note = w.document.querySelector('[data-mark-note]'); note.value = '<script>literal feedback</script>'; note.dispatchEvent(new w.Event('input'));
run("closeDrawer();state.presentation.role='learner';render()"); assert.equal(w.document.querySelectorAll('.material mark').length, 0);
w.document.querySelector('[data-pron-mode]').click(); assert.equal(w.document.querySelectorAll('.material mark').length, 1);
w.document.querySelector('[data-pron-read]').click(); assert.equal(w.document.querySelectorAll('.material mark').length, 0);
w.document.querySelector('[data-word]').click(); assert.equal(run('drawer'), 'word'); run('closeDrawer()');
const exported = w.COLLAB.backup(); assert(!JSON.stringify(exported).includes('invitation'));
w.backupInput = JSON.stringify(exported); const originalSession = run('state.id'); run('installImportedLesson(backupInput)');
assert.notEqual(run('state.id'), originalSession); assert.equal(run('state.annotations.length'), 1);
assert.equal(run("state.drafts['reading:0']"), 'Earlier draft');
assert.deepEqual(JSON.parse(JSON.stringify(w.COLLAB.backup().session)), JSON.parse(JSON.stringify(exported.session)));
run("state.presentation.role='teacher';render();openDrawer('feedback')"); assert(!w.document.querySelector('.drawer script'));
dom.window.close();

const DB = localDB();
const request = (user, path, body, origin = 'https://sprachraum.test') => worker.fetch(new Request('https://sprachraum.test/api/rooms' + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(user ? { 'oai-authenticated-user-id': user } : {}), Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { DB });
const decode = async response => ({ status: response.status, ...(await response.json()) });
const id = crypto.randomUUID(), invitation = 'a'.repeat(64);
let created = await decode(await request('learner', '', { requestId: id, invitation, backup: full })); assert.equal(created.status, 201);
assert.equal((await decode(await request('learner', '', { requestId: id, invitation, backup: full }))).id, id);
assert.equal((await request(null, '')).status, 401);
assert.equal((await request('stranger', '/' + id)).status, 403);
assert.equal((await request('teacher', `/${id}/join`, { invitation: 'b'.repeat(64) })).status, 403);
assert.equal((await request('teacher', `/${id}/join`, { invitation })).status, 200);
assert.equal((await request('another-teacher', `/${id}/join`, { invitation })).status, 409);
assert.equal((await request('learner', `/${id}/close`, {}, 'https://evil.example')).status, 403);
const op = (field, value, before, key) => ({ id: crypto.randomUUID(), field, value, before, ...(key === undefined ? {} : { key }) });
const draftOp = op('drafts', 'Learner-only writing', 'My draft', firstPage);
assert.equal((await request('teacher', `/${id}/ops`, { operations: [draftOp] })).status, 400);
const mark2 = { ...mark, id: crypto.randomUUID(), start: 0, end: 5, quote: 'Äpfel', note: 'The first occurrence.' };
const annotationOp = op('annotations', mark2, null, mark2.id);
const concurrent = await Promise.all([request('learner', `/${id}/ops`, { operations: [draftOp] }), request('teacher', `/${id}/ops`, { operations: [annotationOp] })]);
assert(concurrent.every(r => r.status === 200));
const once = await decode(await request('learner', `/${id}?full=1`));
assert.equal(once.session.drafts[firstPage], 'Learner-only writing'); assert(once.session.annotations.some(a => a.id === mark2.id));
const duplicate = await decode(await request('teacher', `/${id}/ops`, { operations: [annotationOp] })); assert.equal(duplicate.revision, once.revision);
const stale = op('drafts', 'Would overwrite', 'My draft', firstPage); assert.equal((await request('learner', `/${id}/ops`, { operations: [stale] })).status, 409);
const remove = op('annotations', null, mark, mark.id); assert.equal((await request('teacher', `/${id}/ops`, { operations: [remove] })).status, 200);
const latePractice = op('practiced', true, false, mark.id); assert.equal((await request('learner', `/${id}/ops`, { operations: [latePractice] })).status, 200);
const deleted = await decode(await request('learner', `/${id}?full=1`)); assert(!Object.hasOwn(deleted.session.practiced, mark.id));
assert.equal((await request('teacher', `/${id}/ops`, { operations: [op('annotations', mark, mark, mark.id)] })).status, 409);

// Two transport instances, different identities, real API and SQLite, offline replay.
const makeClient = (user, initial) => {
  let offline = false, latest = initial.session, lastStatus;
  const fetcher = async (path, options = {}) => { if (offline) throw new Error('offline'); return request(user, path.replace('/api/rooms', ''), options.method === 'POST' ? JSON.parse(options.body) : undefined); };
  const client = new globalThis.RoomClient({ id, role: user === 'teacher' ? 'teacher' : 'owner', session: initial.session, revision: initial.revision, fetcher, onSnapshot: s => { latest = s; }, onStatus: s => { lastStatus = s; } });
  return { client, get latest() { return latest; }, get status() { return lastStatus; }, offline: value => { offline = value; } };
};
const learner = makeClient('learner', deleted), teacher = makeClient('teacher', deleted);
learner.offline(true); const learnerEdit = structuredClone(learner.latest); learnerEdit.drafts[firstPage] = 'Work written while offline'; learner.client.capture(learnerEdit); await learner.client.tick(); assert.equal(learner.status.kind, 'offline');
const teacherEdit = structuredClone(teacher.latest); teacherEdit.teacherNotes = 'Feedback while the learner reconnects'; teacher.client.capture(teacherEdit); await teacher.client.tick();
learner.offline(false); await learner.client.tick(); await teacher.client.tick();
assert.equal(teacher.latest.drafts[firstPage], 'Work written while offline'); assert.equal(learner.latest.teacherNotes, teacherEdit.teacherNotes); assert.equal(learner.client.pending.length, 0);
const snapshotBeforeConflict = structuredClone(learner.latest);
await request('learner', `/${id}/ops`, { operations: [op('drafts', 'Another tab edit', learner.latest.drafts[firstPage], firstPage)] });
const conflicted = structuredClone(snapshotBeforeConflict); conflicted.drafts[firstPage] = 'My preserved edit'; learner.client.capture(conflicted); await learner.client.tick();
assert.equal(learner.status.kind, 'conflict'); assert.equal(learner.latest.drafts[firstPage], 'My preserved edit'); learner.client.resolve(true); await learner.client.tick(); assert.equal(learner.client.pending.length, 0);
// Byte-bounded batches must drain instead of getting permanently stuck on 413.
let huge = structuredClone(teacher.latest);
for (let i = 0; i < 12; i++) { huge.teacherNotes = String(i).padStart(2, '0') + 'x'.repeat(99990); teacher.client.capture(huge); }
for (let i = 0; i < 5 && teacher.client.pending.length; i++) await teacher.client.tick();
assert.equal(teacher.client.pending.length, 0);
assert.equal((await request('learner', `/${id}/invite`, { invitation: 'c'.repeat(64) })).status, 200);
assert.equal((await request('teacher', `/${id}`)).status, 403);
assert.equal((await request('teacher', `/${id}/join`, { invitation })).status, 403);
assert.equal((await request('new-teacher', `/${id}/join`, { invitation: 'c'.repeat(64) })).status, 200);
assert.equal((await request('learner', `/${id}/close`, {})).status, 200);
assert.equal((await request('new-teacher', `/${id}`)).status, 410);
learner.client.stop(); teacher.client.stop(); DB.close();
// Exercise the actual view-to-transport bridge in two isolated DOM contexts.
const bridgeDB = localDB();
function liveDOM(user, storage = []) {
  const dom = new JSDOM('<div id="app"></div><div id="toast"></div>', { url: 'https://sprachraum.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const run = code => vm.runInContext(code, dom.getInternalVMContext());
  Object.defineProperty(w, 'crypto', { value: webcrypto }); w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  let failWrites=false;
  w.fetch=async (path, options={})=>{
    if(failWrites && path.endsWith('/ops'))throw new Error('offline');
    return worker.fetch(new Request(new URL(path,'https://sprachraum.test'),{method:options.method||'GET',headers:{'oai-authenticated-user-id':user,'Content-Type':'application/json',Origin:'https://sprachraum.test'},...(options.body?{body:options.body}:{})}),{DB:bridgeDB});
  };
  for(const [key,value] of storage)w.localStorage.setItem(key,value);
  for(const file of ['lessons.js','advanced-lessons.js','lesson-format.js','session-format.js','lesson-library.js','lesson-authoring.js','room-client.js','pronunciation.js','collaboration.js','app.js'])run(fs.readFileSync('dist/'+file,'utf8'));
  return {w,run,dom,failWrites:value=>{failWrites=value},storage:()=>Array.from({length:w.localStorage.length},(_,i)=>{const key=w.localStorage.key(i);return [key,w.localStorage.getItem(key)]}),close:()=>{w.COLLAB.beforeLeave();dom.window.close()}};
}
const hostDOM=liveDOM('bridge-learner');hostDOM.w.fixture=testPacket;hostDOM.run('installImportedLesson(fixture)');
const pump=async(...clients)=>{for(let i=0;i<3;i++){await new Promise(resolve=>setTimeout(resolve,20));for(const item of clients)await item.w.COLLAB.syncNow();}};
await hostDOM.w.COLLAB.createRoom();
const connection=JSON.parse(hostDOM.run('JSON.stringify(state.live)'));
assert(connection?.id);
const teacherDOM=liveDOM('bridge-teacher');await teacherDOM.w.COLLAB.openRoom(connection.id,connection.invitation);
assert.equal(teacherDOM.run('state.presentation.role'),'teacher');
teacherDOM.run("state.teacherNotes='Shared teacher feedback';persist()");await pump(teacherDOM,hostDOM);
assert.equal(hostDOM.run('state.teacherNotes'),'Shared teacher feedback');
teacherDOM.failWrites(true);teacherDOM.run("state.teacherNotes='Pending feedback preserved in backup';persist()");await pump(teacherDOM);
const savedBrowser=teacherDOM.storage();teacherDOM.close();
const restoredDOM=liveDOM('bridge-teacher',savedBrowser);restoredDOM.failWrites(true);await restoredDOM.w.COLLAB.openRoom(connection.id);
assert.equal(restoredDOM.w.COLLAB.backup().session.teacherNotes,'Pending feedback preserved in backup');
restoredDOM.failWrites(false);await pump(restoredDOM,hostDOM);
assert.equal(hostDOM.run('state.teacherNotes'),'Pending feedback preserved in backup');
hostDOM.close();restoredDOM.close();bridgeDB.close();
console.log(JSON.stringify({ backupRoundTrips: 3, rangeSelection: 'repeated words, umlauts, emoji and inline word links', restoredState: 'drafts, earlier notes, feedback and marks preserved separately', twoParticipants: 'passed', concurrentEdits: 'passed', offlineReplay: 'passed', conflictingDrafts: 'preserved and resolved', idempotentRetry: 'passed', revokedInvitation: 'enforced', deletedMarkLatePractice: 'safe', largeOfflineBatches: 'drained' }, null, 2));

