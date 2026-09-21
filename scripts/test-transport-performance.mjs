import assert from 'node:assert/strict';
import '../dist/lesson-format.js';
import '../dist/session-format.js';
import '../dist/room-client.js';

const IO = globalThis.SESSION_IO;
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const create = (options = {}) => new globalThis.RoomClient({ id: 'room-performance-test', role: 'owner', session: IO.empty('Transport test'), revision: 1, ...options });
const edit = (client, text) => { const session = IO.clone(client.baseline); session.teacherNotes = text; client.capture(session); };

// Replaying pending edits copies only changed fields, and must never mutate the
// source snapshot or retain mutable references to new operation payloads.
{
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  const annotation = { id: 'mark-copy-on-write', pageId: 'page', block: 'paragraphs:0', start: 0, end: 4, quote: 'word', note: 'Keep me' };
  const snapshot = IO.empty('Immutable replay'); snapshot.annotations.push(annotation); snapshot.practiced[annotation.id] = true; snapshot.drafts.page = 'Original draft';
  freeze(snapshot);
  const original = JSON.stringify(snapshot);
  const operation = (field, key, before, value) => freeze({ id: crypto.randomUUID(), field, key, before, value });
  const removed = IO.apply(snapshot, operation('annotations', annotation.id, annotation, null), 'owner');
  assert.notEqual(removed, snapshot); assert.notEqual(removed.annotations, snapshot.annotations); assert.notEqual(removed.practiced, snapshot.practiced);
  assert.equal(removed.annotations.length, 0); assert.equal(removed.practiced[annotation.id], undefined);
  assert.equal(removed.drafts, snapshot.drafts); assert.equal(removed.checks, snapshot.checks);

  const practiced = IO.apply(snapshot, operation('practiced', annotation.id, true, false), 'owner');
  assert.notEqual(practiced.practiced, snapshot.practiced); assert.equal(practiced.practiced[annotation.id], false);
  assert.equal(practiced.annotations, snapshot.annotations); assert.equal(practiced.drafts, snapshot.drafts);
  const latePractice = IO.apply(freeze(removed), operation('practiced', annotation.id, null, true), 'owner');
  assert.equal(latePractice.practiced[annotation.id], undefined); assert.notEqual(latePractice.practiced, removed.practiced);
  assert.equal(latePractice.annotations, removed.annotations); assert.equal(latePractice.drafts, removed.drafts);

  const mapOp = operation('checks', 'page', null, { selected: 1, checked: false });
  const checked = IO.apply(snapshot, mapOp, 'owner');
  assert.notEqual(checked.checks, snapshot.checks); assert.notEqual(checked.checks.page, mapOp.value); assert.deepEqual(checked.checks.page, mapOp.value);
  assert.equal(checked.drafts, snapshot.drafts); assert.equal(checked.annotations, snapshot.annotations);
  const withoutDraft = IO.apply(snapshot, operation('drafts', 'page', 'Original draft', null), 'owner');
  assert.notEqual(withoutDraft.drafts, snapshot.drafts); assert(!Object.hasOwn(withoutDraft.drafts, 'page')); assert.equal(withoutDraft.annotations, snapshot.annotations);
  const changedMark = { ...annotation, note: 'Updated note' };
  const marked = IO.apply(snapshot, operation('annotations', annotation.id, annotation, changedMark), 'owner');
  assert.notEqual(marked.annotations[0], changedMark); assert.equal(marked.annotations[0].note, 'Updated note'); assert.equal(marked.practiced, snapshot.practiced);
  assert.equal(JSON.stringify(snapshot), original);
}

// An unchanged session or idle response must not clone/persist the pending queue.
{
  let saves = 0, clones = 0;
  const client = create({ saveQueue: () => saves++, fetcher: async () => response({ unchanged: true, revision: 1, acknowledged: [] }) });
  const originalClone = IO.clone, baseline = client.baseline;
  IO.clone = value => { clones++; return originalClone(value); };
  try { for (let i = 0; i < 25; i++) client.capture(baseline); }
  finally { IO.clone = originalClone; }
  assert.equal(client.baseline, baseline);
  assert.equal(clones, 0);
  await client.tick(); client.stop();
  assert.equal(saves, 0);
}

// Unsent edits collapse per field/key, including independent interleaved edits.
{
  const client = create();
  for (let i = 0; i < 100; i++) {
    const session = IO.clone(client.baseline);
    session.teacherNotes = `note ${i}`; session.drafts.page = `draft ${i}`;
    client.capture(session);
  }
  assert.equal(client.pending.length, 2);
  assert.deepEqual(client.pending.map(({ field, before, value }) => ({ field, before, value })), [
    { field: 'teacherNotes', before: '', value: 'note 99' },
    { field: 'drafts', before: null, value: 'draft 99' }
  ]);
  const session = IO.clone(client.baseline); session.teacherNotes = ''; delete session.drafts.page; client.capture(session);
  assert.equal(client.pending.length, 0);
  client.stop();
}

// Queue payloads own their values; later mutations of application objects cannot
// silently change an edit that was persisted or sent.
{
  const client = create(), session = IO.clone(client.baseline);
  session.annotations.push({ id: 'mark-performance-test', pageId: 'page', block: 'paragraphs:0', start: 0, end: 4, quote: 'word', note: 'original' });
  client.capture(session);
  session.annotations[0].note = 'mutated outside capture';
  assert.equal(client.pending[0].value.note, 'original');
  client.stop();
}

// Typing during an in-flight request cannot rewrite the request's operation.
{
  let release, sent;
  const client = create({ fetcher: async (_url, options) => { sent = JSON.parse(options.body).operations; return new Promise(resolve => { release = resolve; }); } });
  edit(client, 'first');
  const attempted = IO.clone(client.pending[0]), sending = client.tick();
  edit(client, 'second'); edit(client, 'third');
  assert.equal(client.pending.length, 2);
  assert.deepEqual(client.pending[0], attempted);
  assert.equal(client.pending[1].before, 'first');
  assert.equal(client.pending[1].value, 'third');
  assert.deepEqual(sent, [attempted]);
  const shared = IO.apply(IO.empty('Transport test'), attempted, 'owner');
  release(response({ acknowledged: [attempted.id], session: shared, revision: 2 }));
  await sending;
  assert.equal(client.pending.length, 1);
  assert.equal(client.baseline.teacherNotes, 'third');
  assert.equal(client.remote.teacherNotes, 'first');
  client.stop();
}

// A lost response must retry the identical ID and payload, even though the server
// may already have committed it. Duplicate/irrelevant acknowledgements do not save.
{
  let requests = [], saves = 0;
  const client = create({ saveQueue: () => saves++, fetcher: async (_url, options) => { requests.push(options.body); throw new Error('Response lost'); } });
  edit(client, 'uncertain'); await client.tick(); await client.tick();
  assert.equal(requests[0], requests[1]);
  assert.equal(saves, 1);
  const attempted = IO.clone(client.pending[0]);
  edit(client, 'later'); edit(client, 'latest');
  assert.deepEqual(client.pending[0], attempted);
  assert.equal(client.pending.length, 2);
  const beforeAck = saves;
  client.fetcher = async () => response({ unchanged: true, revision: 1, acknowledged: ['different-operation'] });
  await client.tick(); client.stop();
  assert.equal(saves, beforeAck);
}

// Persisted edits have unknown delivery state, so restoration treats them as sent.
{
  const initial = create(); edit(initial, 'saved before reload');
  const pending = IO.clone(initial.pending); initial.stop();
  const client = create({ pending });
  edit(client, 'after reload'); edit(client, 'newest');
  assert.equal(client.pending.length, 2);
  assert.deepEqual(client.pending[0], pending[0]);
  assert.equal(client.pending[1].before, 'saved before reload');
  assert.equal(client.pending[1].value, 'newest');
  client.stop();
}

// Conflict resolution replaces the uncertain ID, retains newer local edits, and
// projects exactly the state that a successful strict server replay will produce.
{
  const remote = IO.empty('Transport test'); remote.teacherNotes = 'another device';
  const client = create({ fetcher: async () => response({ conflict: true, error: 'Changed elsewhere', session: remote, revision: 2, acknowledged: [] }, 409) });
  edit(client, 'my first edit'); await client.tick();
  const attempted = IO.clone(client.pending[0]);
  edit(client, 'my latest edit'); client.resolve(true);
  assert.notEqual(client.pending[0].id, attempted.id);
  assert.equal(client.pending[0].before, 'another device');
  assert.equal(client.pending[0].value, 'my first edit');
  assert(!client.attempted.has(client.pending[0].id));
  assert.equal(client.baseline.teacherNotes, 'my latest edit');
  let replayed = remote;
  for (const op of client.pending) replayed = IO.apply(replayed, op, 'owner');
  assert.equal(replayed.teacherNotes, client.baseline.teacherNotes);
  client.fetcher = async () => response({ acknowledged: client.pending.map(op => op.id), session: replayed, revision: 4 });
  await client.tick();
  assert.equal(client.pending.length, 0);
  assert.equal(client.attempted.size, 0);
  client.stop();
}

console.log('Transport performance checks passed: copy-on-write replay, idle work, unsent coalescing, immutable retries, restored queues and conflict replay.');
