import '../dist/lesson-format.js';
import '../dist/session-format.js';
const IO = globalThis.SESSION_IO;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function body(request) {
  if (!request.headers.get('content-type')?.includes('application/json')) fail(415, 'Send JSON.');
  if (Number(request.headers.get('content-length')) > IO.maxBytes + 5000) fail(413, 'This session is too large.');
  const reader = request.body?.getReader(); if (!reader) fail(400, 'Missing request body.');
  const chunks = []; let total = 0;
  while (true) { const part = await reader.read(); if (part.done) break; total += part.value.byteLength; if (total > IO.maxBytes + 5000) { await reader.cancel(); fail(413, 'This session is too large.'); } chunks.push(part.value); }
  const data = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  try { return IO.parse(new TextDecoder().decode(data)); } catch (e) { fail(400, e.message); }
}
const roomById = (db, id) => db.prepare('SELECT * FROM lesson_rooms WHERE id = ?').bind(id).first();
function membership(room, user) {
  if (!room) fail(404, 'Shared session not found.');
  if (room.learner_id === user) return 'owner';
  if (room.teacher_id === user) { if (room.closed) fail(410, 'The learner ended this shared session. Your local copy can still be exported.'); return 'teacher'; }
  fail(403, 'You are not a participant in this session. Open the teacher invitation first.');
}
function responseRoom(room, role, includeLesson = false) {
  return { id: room.id, role: role === 'owner' ? 'learner' : role, revision: room.revision, closed: !!room.closed, teacherJoined: !!room.teacher_id, session: JSON.parse(room.snapshot), ...(includeLesson ? { lesson: JSON.parse(room.packet) } : {}) };
}
export async function handleApi(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/health') return json({ available: !!env.DB, transport: 'http-polling', intervalMs: 1000 });
  const user = request.headers.get('oai-authenticated-user-id');
  if (!user) fail(401, 'Sign in to use shared sessions.');
  if (!env.DB) fail(503, 'Shared storage is unavailable. Your local work is still here.');
  if (request.method !== 'GET' && (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('origin') && request.headers.get('origin') !== url.origin)) fail(403, 'Open the session on this site before editing.');
  const db = env.DB;
  if (path === '/api/rooms' && request.method === 'GET') {
    const result = await db.prepare("SELECT id, json_extract(packet, '$.lesson.title') AS title, revision, learner_id, teacher_id, updated_at, closed FROM lesson_rooms WHERE learner_id = ? OR teacher_id = ? ORDER BY updated_at DESC LIMIT 50").bind(user, user).all();
    return json({ rooms: result.results.map(r => ({ id: r.id, title: r.title, role: r.learner_id === user ? 'learner' : 'teacher', updatedAt: r.updated_at, closed: !!r.closed })) });
  }
  if (path === '/api/rooms' && request.method === 'POST') {
    const data = await body(request), checked = IO.validate(data.backup);
    if (!checked.ok) fail(400, checked.errors.join('\n'));
    // Client-generated request ID makes create safe to retry after an uncertain response.
    if (!IO.uid(data.requestId) || typeof data.invitation !== 'string' || !/^[a-f0-9]{64}$/.test(data.invitation)) fail(400, 'Invalid session invitation.');
    const existing = await roomById(db, data.requestId);
    if (existing) { if (existing.learner_id !== user || existing.invitation_hash !== await hash(data.invitation)) fail(409, 'Session request ID already exists.'); return json(responseRoom(existing, 'owner', true)); }
    const count = await db.prepare('SELECT COUNT(*) AS total FROM lesson_rooms WHERE learner_id = ? AND closed = 0').bind(user).first();
    if (count.total >= 30) fail(409, 'End an older shared session before creating another.');
    const now = Date.now();
    await db.prepare('INSERT INTO lesson_rooms (id, learner_id, invitation_hash, packet, snapshot, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(data.requestId, user, await hash(data.invitation), JSON.stringify(checked.packet), JSON.stringify(checked.session), now, now).run();
    return json(responseRoom(await roomById(db, data.requestId), 'owner', true), 201);
  }
  const match = path.match(/^\/api\/rooms\/([a-zA-Z0-9-]{8,100})(?:\/(join|ops|close|invite))?$/);
  if (!match) fail(404, 'Unknown session endpoint.');
  const [, id, action] = match;
  if (!action && request.method === 'GET') {
    // Idle polls need membership and revision, not the lesson/snapshot blobs.
    const metadata = await db.prepare('SELECT id, learner_id, teacher_id, revision, closed FROM lesson_rooms WHERE id = ?').bind(id).first();
    membership(metadata, user);
    const full = url.searchParams.get('full') === '1';
    if (!full && url.searchParams.has('since') && Number(url.searchParams.get('since')) === metadata.revision) return json({ unchanged: true, revision: metadata.revision, teacherJoined: !!metadata.teacher_id, closed: !!metadata.closed });
    const current = await db.prepare(full ? 'SELECT * FROM lesson_rooms WHERE id = ?' : 'SELECT id, learner_id, teacher_id, revision, closed, snapshot FROM lesson_rooms WHERE id = ?').bind(id).first();
    // Recheck after loading: an invitation may have been revoked in between.
    return json(responseRoom(current, membership(current, user), full));
  }
  let room = await roomById(db, id);
  if (!room) fail(404, 'Shared session not found.');
  if (action === 'join' && request.method === 'POST') {
    const data = await body(request);
    if (room.closed) fail(410, 'This shared session has ended.');
    if (typeof data.invitation !== 'string' || data.invitation.length !== 64 || await hash(data.invitation) !== room.invitation_hash) fail(403, 'This teacher invitation is invalid or has been replaced.');
    if (user === room.learner_id) return json(responseRoom(room, 'owner', true));
    if (room.teacher_id && room.teacher_id !== user) fail(409, 'A teacher has already joined. Ask the learner for a new invitation.');
    await db.prepare('UPDATE lesson_rooms SET teacher_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND teacher_id IS NULL AND invitation_hash = ? AND closed = 0').bind(user, Date.now(), id, room.invitation_hash).run();
    room = await roomById(db, id); membership(room, user);
    return json(responseRoom(room, 'teacher', true));
  }
  const role = membership(room, user);
  if (action === 'invite' && request.method === 'POST') {
    if (role !== 'owner' || room.closed) fail(403, 'Only the learner can renew the teacher invitation.');
    const data = await body(request);
    if (typeof data.invitation !== 'string' || !/^[a-f0-9]{64}$/.test(data.invitation)) fail(400, 'Invalid invitation.');
    await db.prepare('UPDATE lesson_rooms SET invitation_hash = ?, teacher_id = NULL, revision = revision + 1, updated_at = ? WHERE id = ?').bind(await hash(data.invitation), Date.now(), id).run();
    return json({ renewed: true });
  }
  if (action === 'close' && request.method === 'POST') {
    if (role !== 'owner') fail(403, 'Only the learner can end sharing.');
    await db.prepare('UPDATE lesson_rooms SET closed = 1, revision = revision + 1, updated_at = ? WHERE id = ?').bind(Date.now(), id).run();
    return json({ closed: true });
  }
  if (action === 'ops' && request.method === 'POST') {
    if (room.closed) fail(410, 'This shared session has ended. Export any pending work.');
    const data = await body(request);
    if (!Array.isArray(data.operations) || data.operations.length < 1 || data.operations.length > 40) fail(400, 'Send 1–40 edits at a time.');
    const acknowledged = [];
    for (const op of data.operations) {
      if (!IO.uid(op?.id)) fail(400, 'Invalid edit ID.');
      let done = false;
      for (let attempt = 0; attempt < 5 && !done; attempt++) {
        if (await db.prepare('SELECT revision FROM lesson_operations WHERE room_id = ? AND operation_id = ?').bind(id, op.id).first()) { acknowledged.push(op.id); done = true; break; }
        room = await roomById(db, id); const currentRole = membership(room, user);
        if (room.closed) fail(410, 'This shared session has ended.');
        let next;
        try { next = IO.apply(JSON.parse(room.snapshot), op, currentRole); IO.validateState(JSON.parse(room.packet), next); }
        catch (e) { return json({ error: e.message, conflict: !!e.conflict, acknowledged, ...responseRoom(room, currentRole) }, e.conflict ? 409 : 400); }
        const revision = room.revision + 1, now = Date.now();
        const result = await db.batch([
          db.prepare('UPDATE lesson_rooms SET snapshot = ?, revision = ?, last_op = ?, updated_at = ? WHERE id = ? AND revision = ? AND closed = 0 AND (learner_id = ? OR teacher_id = ?)').bind(JSON.stringify(next), revision, op.id, now, id, room.revision, user, user),
          db.prepare('INSERT OR IGNORE INTO lesson_operations (room_id, operation_id, revision, created_at) SELECT id, ?, revision, ? FROM lesson_rooms WHERE id = ? AND revision = ? AND last_op = ?').bind(op.id, now, id, revision, op.id)
        ]);
        if (result[0].meta.changes === 1) { acknowledged.push(op.id); done = true; }
      }
      if (!done) return json({ error: 'Several edits arrived together. Retrying is safe.', acknowledged }, 503);
    }
    const current = await roomById(db, id);
    return json({ acknowledged, ...responseRoom(current, membership(current, user)) });
  }
  fail(405, 'This action is not supported.');
}
export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return await handleApi(request, env);
      const asset = env.ASSETS ? await env.ASSETS.fetch(request) : null;
      if (asset && asset.status !== 404) return asset;
      const embedded = typeof __EMBEDDED_ASSETS__ !== 'undefined' ? __EMBEDDED_ASSETS__ : {};
      const value = embedded[url.pathname === '/' ? '/index.html' : url.pathname];
      return value ? new Response(value.text, { headers: { 'Content-Type': value.type, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' } }) : new Response('Not found', { status: 404 });
    } catch (e) { if (!e.status) console.error('Lesson service failed:', e.name); return json({ error: e.status ? e.message : 'Shared storage is unavailable. Keep working locally and retry.' }, e.status || 503); }
  }
};
