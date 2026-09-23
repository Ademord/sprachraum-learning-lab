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
for (const file of ['lessons.js','advanced-lessons.js','lesson-format.js','session-format.js','lesson-library.js','lesson-authoring.js','room-client.js','lesson-width.js','pronunciation.js','collaboration.js','app.js']) run(fs.readFileSync('dist/' + file, 'utf8'));
w.inputPacket = testPacket; run('installImportedLesson(inputPacket)');
w.document.querySelector('[data-view]').click(); w.document.querySelector('[data-pron-mode]').click();
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
w.document.querySelector('[data-pron-mode]').click(); assert.equal(w.document.querySelectorAll('.material mark').length, 0);
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

// Idle polls read only membership/revision metadata. Changed polls omit the
// immutable lesson; a full request includes it even when its revision matches.
const originalPrepare = DB.prepare;
const tracedGet = async (user, path, revokeAfterMetadata = false) => {
  const queries = [];
  DB.prepare = sql => {
    queries.push(sql);
    const statement = originalPrepare(sql);
    if (!revokeAfterMetadata || !/^SELECT id, learner_id, teacher_id, revision, closed FROM/.test(sql)) return statement;
    return { ...statement, bind: (...values) => {
      const bound = statement.bind(...values);
      return { ...bound, first: async () => {
        const metadata = await bound.first();
        await originalPrepare('UPDATE lesson_rooms SET teacher_id = NULL, revision = revision + 1 WHERE id = ?').bind(id).run();
        return metadata;
      } };
    } };
  };
  try { return { result: await decode(await request(user, path)), queries }; }
  finally { DB.prepare = originalPrepare; }
};
const idleRead = await tracedGet('teacher', `/${id}?since=${deleted.revision}`);
assert.equal(idleRead.result.unchanged, true); assert.equal(idleRead.queries.length, 1);
assert(!/snapshot|packet|SELECT\s+\*/i.test(idleRead.queries[0]));
const changedRead = await tracedGet('teacher', `/${id}?since=0`);
assert.equal(changedRead.result.status, 200); assert(changedRead.result.session); assert(!changedRead.result.lesson);
assert.equal(changedRead.queries.length, 2); assert(/snapshot/i.test(changedRead.queries[1]));
assert(changedRead.queries.every(sql => !/packet|SELECT\s+\*/i.test(sql)));
const fullRead = await tracedGet('teacher', `/${id}?since=${deleted.revision}&full=1`);
assert.deepEqual(fullRead.result.lesson, testPacket); assert(fullRead.result.session); assert(!fullRead.result.unchanged);
const revokedBetweenReads = await tracedGet('teacher', `/${id}?since=0`, true);
assert.equal(revokedBetweenReads.result.status, 403); assert(!revokedBetweenReads.result.session);
assert.equal((await request('teacher', `/${id}/join`, { invitation })).status, 200);

// Two transport instances, different identities, real API and SQLite, offline replay.
const makeClient = (user, initial) => {
  let offline = false, latest = initial.session, lastStatus; const postBytes = [];
  const fetcher = async (path, options = {}) => { if (options.body) postBytes.push(new TextEncoder().encode(options.body).length); if (offline) throw new Error('offline'); return request(user, path.replace('/api/rooms', ''), options.method === 'POST' ? JSON.parse(options.body) : undefined); };
  const client = new globalThis.RoomClient({ id, role: user === 'teacher' ? 'teacher' : 'owner', session: initial.session, revision: initial.revision, fetcher, onSnapshot: s => { latest = s; }, onStatus: s => { lastStatus = s; } });
  return { client, postBytes, get latest() { return latest; }, get status() { return lastStatus; }, offline: value => { offline = value; } };
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
let huge = structuredClone(teacher.latest); teacher.offline(true);
for (let i = 0; i < 12; i++) { huge.teacherNotes = String(i).padStart(2, '0') + 'x'.repeat(99990); teacher.client.capture(huge); await teacher.client.tick(); }
assert(teacher.client.pending.length > 1, 'uncertain sends cannot all collapse into one edit');
assert(new TextEncoder().encode(JSON.stringify({ operations: teacher.client.pending })).length > 1400000, 'the pending queue requires more than one byte-bounded batch');
teacher.offline(false);
for (let i = 0; i < 5 && teacher.client.pending.length; i++) await teacher.client.tick();
assert.equal(teacher.client.pending.length, 0);
assert(Math.max(...teacher.postBytes) <= 1400000, 'every POST stays within the configured byte budget');
assert.equal((await request('learner', `/${id}/invite`, { invitation: 'c'.repeat(64) })).status, 200);
assert.equal((await request('teacher', `/${id}`)).status, 403);
assert.equal((await request('teacher', `/${id}/join`, { invitation })).status, 403);
assert.equal((await request('new-teacher', `/${id}/join`, { invitation: 'c'.repeat(64) })).status, 200);
assert.equal((await request('learner', `/${id}/close`, {})).status, 200);
assert.equal((await request('new-teacher', `/${id}`)).status, 410);
learner.client.stop(); teacher.client.stop(); DB.close();
// Exercise the actual view-to-transport bridge in two isolated DOM contexts.
const bridgeDB = localDB();
function liveDOM(user, storage = [], { hash = '', pendingInvite } = {}) {
  const dom = new JSDOM('<div id="app"></div><div id="toast"></div>', { url: 'https://sprachraum.test/' + hash, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window; const run = code => vm.runInContext(code, dom.getInternalVMContext());
  Object.defineProperty(w, 'crypto', { value: webcrypto }); w.TextEncoder=TextEncoder;w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  let failWrites=false, nextPollGate=null;
  const metrics={storageWrites:0,backupExports:0};
  const originalSetItem=w.Storage.prototype.setItem;
  w.Storage.prototype.setItem=function(key,value){if(this===w.localStorage)metrics.storageWrites++;return originalSetItem.call(this,key,value)};
  w.fetch=async (path, options={})=>{
    if(failWrites && path.endsWith('/ops'))throw new Error('offline');
    const result=await worker.fetch(new Request(new URL(path,'https://sprachraum.test'),{method:options.method||'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),'Content-Type':'application/json',Origin:'https://sprachraum.test'},...(options.body?{body:options.body}:{})}),{DB:bridgeDB});
    if(nextPollGate && path.includes('?since=')){const gate=nextPollGate;nextPollGate=null;gate.arrived();await gate.wait;}
    return result;
  };
  for(const [key,value] of storage)w.localStorage.setItem(key,value);
  if (pendingInvite) w.sessionStorage.setItem('sprachraum.pending-invitation.v1', pendingInvite);
  for(const file of ['lessons.js','advanced-lessons.js','lesson-format.js','session-format.js','lesson-library.js','lesson-authoring.js','room-client.js','lesson-width.js','pronunciation.js','collaboration.js','app.js'])run(fs.readFileSync('dist/'+file,'utf8'));
  const originalExport=w.SESSION_IO.exportState;w.SESSION_IO.exportState=(...args)=>{metrics.backupExports++;return originalExport(...args)};
  const holdNextPoll=()=>{let arrived,release;const reached=new Promise(resolve=>{arrived=resolve}),wait=new Promise(resolve=>{release=resolve});nextPollGate={arrived,wait};return {reached,release}};
  return {w,run,dom,metrics,resetMetrics:()=>{metrics.storageWrites=0;metrics.backupExports=0},holdNextPoll,failWrites:value=>{failWrites=value},storage:()=>Array.from({length:w.localStorage.length},(_,i)=>{const key=w.localStorage.key(i);return [key,w.localStorage.getItem(key)]}),close:()=>{w.COLLAB.beforeLeave();dom.window.close()}};
}
const hostDOM=liveDOM('bridge-learner');hostDOM.w.fixture=testPacket;hostDOM.run('installImportedLesson(fixture)');
const pump=async(...clients)=>{for(let i=0;i<3;i++){await new Promise(resolve=>setTimeout(resolve,20));for(const item of clients)await item.w.COLLAB.syncNow();}};
const hostDocument=hostDOM.w.document, notebookButton=hostDocument.querySelector('[data-notes]');
assert(!hostDocument.querySelector('.lesson-tools [data-live]'));
assert(hostDocument.querySelector('[data-notebook-sync]').hidden);
notebookButton.focus(); notebookButton.click();
hostDocument.querySelector('[data-notebook-section="live"]').click();
assert.equal(hostDOM.run('drawer'),'live'); assert(hostDocument.querySelector('[data-create-live]'));
assert.equal(hostDocument.activeElement.dataset.notebookSection,'live');
hostDocument.querySelector('[data-notebook-section="notes"]').click();
assert.equal(hostDOM.run('drawer'),'notes');
hostDOM.run('closeDrawer()'); assert.equal(hostDocument.activeElement,notebookButton);
await hostDOM.w.COLLAB.createRoom();
assert(!hostDocument.querySelector('[data-notebook-sync]').hidden,'sharing reveals the existing Notebook indicator without a shell render');
hostDOM.run("savePhrase('Notebook sharing test')");
assert(!hostDocument.querySelector('[data-notebook-sync]').hidden,'saving a phrase preserves the sync indicator');
const connection=JSON.parse(hostDOM.run('JSON.stringify(state.live)'));
assert(connection?.id);
const teacherDOM=liveDOM('bridge-teacher');await teacherDOM.w.COLLAB.openRoom(connection.id,connection.invitation);
assert.equal(teacherDOM.run('state.presentation.role'),'teacher');
teacherDOM.run("state.teacherNotes='Shared teacher feedback';persist()");await pump(teacherDOM,hostDOM);
assert.equal(hostDOM.run('state.teacherNotes'),'Shared teacher feedback');
hostDOM.resetMetrics();teacherDOM.resetMetrics();
for(let i=0;i<5;i++){await hostDOM.w.COLLAB.syncNow();await teacherDOM.w.COLLAB.syncNow()}
for(const participant of [hostDOM,teacherDOM])assert.deepEqual(participant.metrics,{storageWrites:0,backupExports:0},'unchanged live polls do no backup export or storage write');

// A remote response can arrive during the local 350ms capture debounce. Hold a
// changed snapshot in flight, type locally, then release it immediately.
teacherDOM.run("state.teacherNotes='Feedback arriving during typing';persist()");await pump(teacherDOM);
const heldPoll=hostDOM.holdNextPoll(),incoming=hostDOM.w.COLLAB.syncNow();await heldPoll.reached;
hostDOM.resetMetrics();
hostDOM.run("state.drafts[key()]='Draft typed just before remote feedback';persist()");
assert.equal(hostDOM.metrics.backupExports,0,'draft is still waiting for its debounce');
heldPoll.release();await incoming;
assert.equal(hostDOM.run('state.teacherNotes'),'Feedback arriving during typing');
assert.equal(hostDOM.run('state.drafts[key()]'),'Draft typed just before remote feedback');
assert(hostDOM.run("state.pendingEdits.some(op=>op.field==='drafts'&&op.value==='Draft typed just before remote feedback')"));
await pump(hostDOM,teacherDOM);
assert.equal(teacherDOM.run('state.drafts[key()]'),'Draft typed just before remote feedback');
assert.equal(hostDOM.run('state.pendingEdits.length'),0);
teacherDOM.failWrites(true);teacherDOM.run("state.teacherNotes='Pending feedback preserved in backup';persist()");await pump(teacherDOM);
assert(teacherDOM.w.document.querySelector('[data-notebook-sync]').classList.contains('offline'));
assert.match(teacherDOM.w.document.querySelector('[data-notebook-status-text]').textContent,/Connection interrupted/);
const savedBrowser=teacherDOM.storage();teacherDOM.close();
const restoredDOM=liveDOM('bridge-teacher',savedBrowser);restoredDOM.failWrites(true);await restoredDOM.w.COLLAB.openRoom(connection.id);
assert.equal(restoredDOM.w.COLLAB.backup().session.teacherNotes,'Pending feedback preserved in backup');
restoredDOM.failWrites(false);await pump(restoredDOM,hostDOM);
assert.equal(hostDOM.run('state.teacherNotes'),'Pending feedback preserved in backup');
const anonymousDOM = liveDOM(null, [], { hash: `#room=${connection.id}&invite=${connection.invitation}` }); await pump(anonymousDOM);
assert.equal(anonymousDOM.w.location.hash, '');
const pendingInvite = anonymousDOM.w.sessionStorage.getItem('sprachraum.pending-invitation.v1');
assert.equal(JSON.parse(pendingInvite).token, connection.invitation);
const signInLink = anonymousDOM.w.document.querySelector('a[href^="/signin-with-chatgpt"]');
assert(signInLink); assert.equal(signInLink.target, '_top'); assert(!signInLink.href.includes(connection.invitation));
assert.equal(anonymousDOM.run('state'), null, 'anonymous invitation does not expose room content'); anonymousDOM.close();
const signedInDOM = liveDOM('bridge-teacher', [], { pendingInvite }); await pump(signedInDOM);
assert.equal(signedInDOM.run('state.live.id'), connection.id);
assert.equal(signedInDOM.w.sessionStorage.getItem('sprachraum.pending-invitation.v1'), null);
assert(!JSON.stringify(signedInDOM.w.COLLAB.backup()).includes(connection.invitation)); signedInDOM.close();
hostDOM.close();restoredDOM.close();bridgeDB.close();
console.log(JSON.stringify({ backupRoundTrips: 3, rangeSelection: 'repeated words, umlauts, emoji and inline word links', restoredState: 'drafts, earlier notes, feedback and marks preserved separately', twoParticipants: 'passed', concurrentEdits: 'passed', offlineReplay: 'passed', conflictingDrafts: 'preserved and resolved', idempotentRetry: 'passed', revokedInvitation: 'enforced', deletedMarkLatePractice: 'safe', largeOfflineBatches: 'drained', idleBridge: 'no backup exports or storage writes', dirtyDraftDuringRemoteResponse: 'preserved and sent', databasePolling: 'metadata only when unchanged; no lesson on changed poll', revocationBetweenReads: 'denied' }, null, 2));

