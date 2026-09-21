/* Session views, pronunciation anchors, and the bridge to the room transport. */
(function (root) {
  'use strict';
  const IO = root.SESSION_IO;
  let client = null, applying = false, captureTimer, status = { text: '', kind: '' }, selected = null, invitation = null, follow = false, navigationEpoch = 0, refreshPending = false;
  const uuid = () => crypto.randomUUID();
  const role = () => state?.presentation?.role || 'learner';
  const canTeach = () => role() === 'teacher';
  const showing = () => canTeach() || !!state?.presentation?.showMarks;
  function ensure(s = state) {
    if (!s) return;
    s.annotations ||= []; s.practiced ||= {}; s.teacherNotes ||= ''; s.presentation ||= { role: 'learner', showMarks: false };
  }
  function sourceFor(s = state) {
    if (s.lesson !== 'custom') return { runtime: LESSONS[s.lesson], packet: LESSON_LIBRARY.packet(s.lesson) };
    const runtime = { title: s.topic, label: s.topic, goal: 'Work through your material with your teacher.' };
    for (const [area, label] of tabs) runtime[area] = [{ id: `${area}:0`, kind: 'reading', kicker: label, title: label, paragraphs: [s.drafts[`material:${area}:0`] || 'Add your own material with your teacher.'], question: 'Was möchtest du hier üben?', coach: 'Discuss your material and response together.' }];
    return { runtime, packet: LESSON_IO.fromLesson(runtime) };
  }
  function backup(s = state) { ensure(s); const source = sourceFor(s); return IO.exportState(s, source.runtime, source.packet); }
  function downloadBackup(s = state) {
    try { downloadFile('sprachraum-session.json', JSON.stringify(backup(s), null, 2), 'application/json'); notify('Full session downloaded: lesson, notes, marks and progress.'); }
    catch (e) { notify('Could not export: ' + e.message); }
  }
  function restore(checked, lessonId) {
    const id = 'restored-' + uuid();
    sessions[id] = IO.importState(checked.session, LESSONS[lessonId], checked.packet, id, lessonId);
    openSession(id); return id;
  }
  function toolbar() {
    ensure();
    return `<div class="lesson-tools"><div class="view-controls"><label class="sr-only" for="lesson-view">Lesson view</label><select id="lesson-view" data-view ${state.live?.role === 'teacher' ? 'disabled' : ''}><option value="learner" ${!canTeach() ? 'selected' : ''}>Learner view</option><option value="teacher" ${canTeach() ? 'selected' : ''}>Teacher view</option></select>${canTeach() ? '<span class="selection-hint">Select a word or phrase to mark pronunciation.</span>' : `<label class="marks-toggle"><input type="checkbox" data-show-marks ${showing() ? 'checked' : ''}> Show teacher marks</label>`}<button class="quiet" data-feedback>Review <span data-mark-count>${state.annotations.length}</span></button></div><button class="secondary" data-live>${state.live ? 'Shared session' : 'With my teacher'}</button><p class="sync-state ${esc(status.kind)}" data-sync-status role="status">${state.live ? esc(status.text || 'Connecting…') : 'On this device'}</p></div>`;
  }
  function markedHTML(text, pageId, block) {
    const clean = IO.visibleText(text), marks = showing() ? (state.annotations || []).filter(a => a.pageId === pageId && a.block === block && clean.slice(a.start, a.end) === a.quote) : [];
    if (!marks.length) return canTeach() ? esc(clean) : markup(text);
    const cuts = [...new Set([0, clean.length, ...marks.flatMap(a => [a.start, a.end])])].sort((a, b) => a - b);
    return cuts.slice(0, -1).map((start, i) => {
      const mark = marks.find(a => a.start <= start && a.end >= cuts[i + 1]), segment = esc(clean.slice(start, cuts[i + 1]));
      return mark ? `<mark class="pronunciation-mark ${state.practiced[mark.id] ? 'practiced' : ''}" data-mark="${esc(mark.id)}" title="${esc(mark.note || 'Pronunciation practice')}">${segment}</mark>` : segment;
    }).join('');
  }
  function text(text, block, pageId = key()) { return `<span class="annotatable" data-annotatable data-page-id="${esc(pageId)}" data-block="${esc(block)}">${markedHTML(text, pageId, block)}</span>`; }
  function referencePage(p) {
    if (!p.reference) return null;
    return tabs.flatMap(([area]) => LESSONS[state.lesson]?.[area] || []).find(other => other !== p && JSON.stringify(other.paragraphs) === JSON.stringify(p.reference))?.id || null;
  }
  function selectionAnchor(selection) {
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    const element = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('[data-annotatable]');
    if (!element || !element.contains(range.endContainer)) return null;
    const before = range.cloneRange(); before.selectNodeContents(element); before.setEnd(range.startContainer, range.startOffset);
    let start = before.toString().length, end = start + range.toString().length;
    const content = element.textContent;
    while (start < end && /\s/u.test(content[start])) start++;
    while (end > start && /\s/u.test(content[end - 1])) end--;
    if (end <= start || end - start > 500) return null;
    return { pageId: element.dataset.pageId, block: element.dataset.block, start, end, quote: content.slice(start, end), element };
  }
  function captureSelection() {
    if (!state || !canTeach() || view !== 'session' || drawer) return;
    const anchor = selectionAnchor(root.getSelection?.());
    if (!anchor) return;
    selected = anchor;
    document.querySelector('.selection-action')?.remove();
    const button = document.createElement('button'); button.className = 'primary selection-action'; button.textContent = 'Mark pronunciation';
    button.onpointerdown = e => e.preventDefault(); button.onclick = addSelected;
    const rect = anchor.element.getBoundingClientRect();
    button.style.top = Math.min(root.innerHeight - 65, Math.max(12, rect.bottom + 8)) + 'px';
    button.style.left = Math.min(root.innerWidth - 210, Math.max(12, rect.left)) + 'px';
    document.body.appendChild(button);
  }
  function addSelected() {
    if (!selected || !canTeach()) return;
    ensure(); const { element, ...anchor } = selected;
    if (state.annotations.some(a => a.pageId === anchor.pageId && a.block === anchor.block && a.start === anchor.start && a.end === anchor.end)) { notify('That selection is already marked.'); return; }
    const candidate = { id: uuid(), ...anchor, note: '' };
    state.annotations.push(candidate);
    try { backup(); } catch (e) { state.annotations.pop(); notify(e.message); return; }
    persist(); root.getSelection?.()?.removeAllRanges(); document.querySelector('.selection-action')?.remove(); selected = null;
    paintMarks(); notify('Marked for pronunciation review.');
  }
  function paintMarks() {
    if (!state || view !== 'session') return;
    const { packet, runtime } = sourceFor(); const ids = IO.maps(runtime, packet).toPortable;
    document.querySelectorAll('[data-annotatable]').forEach(el => {
      const content = IO.block(packet, ids.get(el.dataset.pageId), el.dataset.block, true);
      if (content === null) return;
      const html = markedHTML(content, el.dataset.pageId, el.dataset.block);
      if (el.innerHTML !== html) { el.innerHTML = html; el.querySelectorAll('[data-word]').forEach(word => word.onclick = () => openDrawer('word', word.dataset.word)); }
    });
    document.querySelectorAll('[data-mark-count]').forEach(el => el.textContent = state.annotations.length);
  }
  function feedbackBody() {
    ensure();
    const teacher = canTeach();
    return `<p class="intro">${teacher ? 'Mark words in the text, then add a pronunciation hint here.' : 'Read each marked phrase aloud. Your teacher’s notes stay with the lesson.'}</p>${state.annotations.length ? `<p class="review-progress">${state.annotations.filter(a => state.practiced[a.id]).length} of ${state.annotations.length} practised</p>` : '<p class="notebook-empty">No pronunciation marks yet. In Teacher view, select text and choose Mark pronunciation.</p>'}${state.annotations.map(a => `<section class="feedback-item"><h3 lang="de">${esc(a.quote)}</h3><p class="hint">${esc(draftLabel(a.pageId))}</p>${teacher ? `<label class="response-label" for="note-${esc(a.id)}">Pronunciation hint</label><textarea id="note-${esc(a.id)}" class="draft" data-mark-note="${esc(a.id)}" maxlength="4000" placeholder="Stress, sound, or a word to compare…">${esc(a.note)}</textarea>` : a.note ? `<p class="pronunciation-note">${esc(a.note)}</p>` : ''}<div class="feedback-actions"><button class="source-button" data-goto-mark="${esc(a.id)}">Go to text</button>${teacher ? `<button class="source-button" data-delete-mark="${esc(a.id)}">Remove mark</button>` : `<label><input type="checkbox" data-practiced="${esc(a.id)}" ${state.practiced[a.id] ? 'checked' : ''}> Practised</label>`}</div></section>`).join('')}<div class="note"><label for="feedback-notes" class="response-label">Teacher’s lesson notes</label>${teacher ? `<textarea id="feedback-notes" class="draft" data-feedback-notes maxlength="100000">${esc(state.teacherNotes)}</textarea>` : `<p class="pronunciation-note">${esc(state.teacherNotes || 'No teacher notes yet.')}</p>`}</div><button class="primary" data-backup>Download full session JSON</button>`;
  }
  function liveBody() {
    const live = state?.live;
    return `<p class="intro">Share this lesson and its notes with your teacher. Each person can move around independently.</p>${live ? `<p class="sync-state ${esc(status.kind)}" data-sync-status role="status">${esc(status.text || 'Connecting…')}</p>${status.conflict ? `<div class="storage-warning"><p>Your pending work is still on this device. Download a full backup before leaving.</p>${!status.conflict.permanent ? '<button class="secondary" data-conflict-local>Keep my edit</button> <button class="secondary" data-conflict-server>Use shared edit</button>' : '<button class="secondary" data-reconnect>Try reconnecting</button>'}</div>` : ''}${live.role === 'learner' ? live.invitation ? inviteHTML(live.id, live.invitation) : '<button class="secondary" data-new-invite>Create a new teacher invitation</button><p class="hint">A new invitation disconnects the previous teacher.</p>' : `<label class="follow-control"><input type="checkbox" data-follow ${follow ? 'checked' : ''}> Follow the learner’s page</label>`}<button class="secondary" data-backup>Download full session JSON</button><div class="live-end"><button class="source-button" data-leave-live>Leave this screen</button>${live.role === 'learner' ? '<button class="source-button" data-end-live>End shared session</button>' : ''}</div>` : state ? '<p class="hint">Starting a shared session sends this lesson, your drafts and notes to the session server. Only you and the invited teacher can open the room.</p><button class="primary" data-create-live>Start shared session</button><p class="hint">Your teacher also needs permission to open this Site.</p>' : ''}<p class="block-title">Your shared sessions</p><div data-cloud-rooms><p class="hint">Loading…</p></div><p class="hint"><a href="architecture.html" target="_blank" rel="noopener">How synchronization works</a></p><p class="hint" data-live-error role="status"></p>`;
  }
  function inviteHTML(id, token) {
    const link = `${location.origin}/#room=${encodeURIComponent(id)}&invite=${token}`;
    return `<label class="response-label" for="teacher-link">Teacher invitation</label><input class="brief-input" id="teacher-link" readonly value="${esc(link)}"><button class="primary" data-copy-invite>Copy teacher link</button><p class="hint">Send this privately to your teacher. It joins one teacher to this session. Site access is still required.</p>`;
  }
  async function api(path, bodyValue) {
    const response = await fetch('/api/rooms' + path, { method: bodyValue === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, ...(bodyValue === undefined ? {} : { body: JSON.stringify(bodyValue) }), credentials: 'same-origin', cache: 'no-store' });
    let value; try { value = await response.json(); } catch { throw new Error('The sharing service is unavailable. Your local lesson is still here.'); }
    if (!response.ok) throw new Error(value.error || 'Could not open the shared session.'); return value;
  }
  const token = () => [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
  function saveLocal() { applying = true; try { persist(); } finally { applying = false; } }
  function capture() { if (client && state && state.live?.id === client.id && !applying) { try { client.capture(backup().session); } catch (e) { setStatus({ text: e.message, kind: 'blocked' }); } } }
  function changed() { if (!applying && client) { clearTimeout(captureTimer); captureTimer = setTimeout(capture, 350); } }
  function setStatus(next) {
    if (!storageOK && next.pending) next = { ...next, text: next.text + ' Browser storage is unavailable; keep this tab open or export a backup.' };
    status = next;
    document.querySelectorAll('[data-sync-status]').forEach(el => { el.textContent = next.text; el.className = 'sync-state ' + (next.kind || ''); });
    if (drawer === 'live' && (next.kind === 'conflict' || next.kind === 'blocked')) openDrawer('live');
  }
  function refreshViews() {
    if (!refreshPending || view !== 'session' || document.activeElement?.matches('textarea,input,select') || root.getSelection?.()?.toString()) return;
    refreshPending = false; const panel = drawer, y = root.scrollY;
    render(); if (panel) openDrawer(panel); if (typeof root.scrollTo === 'function') root.scrollTo(0, y);
  }
  function attach(data, localState, pending = []) {
    client?.stop(); clearTimeout(captureTimer);
    setStatus({ text: 'Connecting…', kind: 'pending' });
    const activeId = localState.id, source = sourceFor(localState);
    client = new RoomClient({ id: data.id, role: data.role === 'teacher' ? 'teacher' : 'owner', revision: data.revision, session: data.session, pending,
      saveQueue: queue => { localState.pendingEdits = IO.clone(queue); if (state?.id === activeId) saveLocal(); },
      onStatus: setStatus,
      onSnapshot: (snapshot, remote) => {
        if (state?.id !== activeId) return;
        const previousUI = JSON.stringify([state.tones,state.checks,state.reveals,state.saved,state.teacherNotes]);
        const localPosition = { tab: state.tab, pages: state.pages, presentation: state.presentation };
        const translated = IO.importState(snapshot, source.runtime, source.packet, state.id, state.lesson);
        const next = { ...translated, live: state.live, pendingEdits: client.pending };
        next.presentation = localPosition.presentation;
        if (data.role !== 'teacher' || !follow) { next.tab = localPosition.tab; next.pages = localPosition.pages; }
        const navigated = next.tab !== state.tab || next.pages[next.tab] !== state.pages[state.tab];
        Object.assign(state, next); sessions[state.id] = state; saveLocal();
        if (previousUI !== JSON.stringify([state.tones,state.checks,state.reveals,state.saved,state.teacherNotes])) refreshPending = true;
        if (view === 'session') {
          if (navigated) render(); else {
            paintMarks();
            document.querySelectorAll('[data-draft]').forEach(el => { if (document.activeElement !== el && el.value !== (state.drafts[el.dataset.draft] || '')) el.value = state.drafts[el.dataset.draft] || ''; });
            if (drawer === 'feedback' && !document.activeElement?.matches('textarea')) openDrawer('feedback');
            refreshViews();
          }
        }
      }
    });
    // Flush local changes immediately before accepting a new remote snapshot.
    const accept = client.accept.bind(client);
    client.accept = value => { if (state?.id === activeId) capture(); accept(value); };
    client.onSnapshot(IO.clone(client.baseline), data);
    client.start();
  }
  async function createRoom() {
    const initiatingState = state, epoch = navigationEpoch;
    const button = document.querySelector('[data-create-live]'); if (button) button.disabled = true;
    try {
      const full = backup(), id = initiatingState.pendingRoom?.id || uuid(), invitation = initiatingState.pendingRoom?.invitation || token();
      initiatingState.pendingRoom = { id, invitation }; saveLocal();
      const data = await api('', { requestId: id, invitation, backup: full });
      delete initiatingState.pendingRoom; initiatingState.live = { id: data.id, role: 'learner', invitation }; sessions[initiatingState.id] = initiatingState; saveLocal();
      if (state !== initiatingState || epoch !== navigationEpoch) return;
      const editsDuringCreate = IO.diff(full.session, backup(initiatingState).session, 'owner', uuid);
      attach(data, initiatingState, editsDuringCreate); openDrawer('live');
    } catch (e) { showError(e.message); if (button) button.disabled = false; }
  }
  function showError(message) { const field = document.querySelector('[data-live-error]'); if (field) field.textContent = message; else notify(message); }
  async function openRoom(id, joinToken) {
    try {
      beforeLeave();
      const epoch = navigationEpoch;
      const data = joinToken ? await api(`/${id}/join`, { invitation: joinToken }) : await api(`/${id}?full=1`);
      if (epoch !== navigationEpoch) return;
      const checked = IO.validate({ format: 'sprachraum.session', version: 1, lesson: data.lesson, session: data.session });
      if (!checked.ok) throw new Error(checked.errors.join(' '));
      const added = LESSON_LIBRARY.add(data.lesson); if (!added.ok) throw new Error(added.errors.join(' '));
      const localId = `live-${data.id}-${data.role}`;
      const previous = sessions[localId] || Object.values(sessions).find(s => s.live?.id === data.id && s.live?.role === data.role), pending = previous?.pendingEdits || [];
      sessions[localId] = IO.importState(checked.session, LESSONS[added.id], checked.packet, localId, added.id);
      sessions[localId].live = { id: data.id, role: data.role, ...(previous?.live?.invitation ? { invitation: previous.live.invitation } : {}) };
      sessions[localId].presentation = { role: data.role === 'teacher' ? 'teacher' : 'learner', showMarks: false };
      sessions[localId].pendingEdits = pending;
      if (data.closed) { delete sessions[localId].live; const restoredId='restored-'+uuid(); sessions[restoredId]={...sessions[localId],id:restoredId};openSession(restoredId,false);notify('Ended session opened as a separate local copy.');return; }
      openSession(localId, false); attach(data, state, pending);
    } catch (e) { showError(e.message); }
  }
  async function reconnect() {
    if (!state?.live) return;
    const s = state; beforeLeave(); const before = backup(s).session, epoch=navigationEpoch;
    try { const data = await api(`/${s.live.id}?full=1`); if (state === s && epoch===navigationEpoch) attach(data, s, [...(s.pendingEdits||[]),...IO.diff(before,backup(s).session,s.live.role==='teacher'?'teacher':'owner',uuid)]); }
    catch (e) { setStatus({ text: e.message, kind: 'offline' }); }
  }
  async function cloudRooms() {
    try {
      const data = await api(''); if (drawer !== 'live') return;
      const target = document.querySelector('[data-cloud-rooms]'); if (!target) return;
      target.innerHTML = data.rooms.length ? data.rooms.map(r => `<button class="topic-choice" data-open-room="${esc(r.id)}"><span>${esc(r.title)}<small>${r.role === 'teacher' ? 'Teacher' : 'Learner'}${r.closed ? ' · ended' : ''}</small></span><span>↗</span></button>`).join('') : '<p class="hint">No shared sessions yet.</p>';
      target.querySelectorAll('[data-open-room]').forEach(el => el.onclick = () => openRoom(el.dataset.openRoom));
    } catch (e) { if (drawer === 'live') { const target = document.querySelector('[data-cloud-rooms]'); if (target) target.innerHTML = '<p class="hint">' + esc(e.message) + '</p>'; } }
  }
  function beforeLeave() { capture(); navigationEpoch++; clearTimeout(captureTimer); client?.stop(); client = null; selected = null; document.querySelector('.selection-action')?.remove(); }
  function bind() {
    const all = (sel, fn) => document.querySelectorAll(sel).forEach(el => el.onclick = () => fn(el));
    const heading=document.querySelector('[data-heading]'),toggle=document.querySelector('[data-heading-toggle]');
    if(heading&&toggle){let pinned=false;const expand=value=>{heading.querySelectorAll('[data-heading-detail]').forEach(el=>el.hidden=!value);toggle.setAttribute('aria-expanded',String(value));heading.classList.toggle('expanded',value);};heading.onpointerenter=e=>{if(e.pointerType!=='touch')expand(true)};heading.onpointerleave=()=>{if(!pinned&&!heading.contains(document.activeElement))expand(false)};toggle.onfocus=()=>expand(true);toggle.onclick=()=>{pinned=!pinned;expand(pinned)};heading.onfocusout=()=>setTimeout(()=>{if(!pinned&&!heading.contains(document.activeElement))expand(false)},0);heading.onkeydown=e=>{if(e.key==='Escape'){pinned=false;expand(false)}};}
    all('[data-backup]', () => downloadBackup()); all('[data-feedback]', () => { ensure(); if (!canTeach()) state.presentation.showMarks = true; persist(); render(); openDrawer('feedback'); });
    all('[data-live]', () => openDrawer('live')); all('[data-create-live]', createRoom);
    all('[data-open-session]', el => openSession(el.dataset.openSession));
    const viewSelect = document.querySelector('[data-view]'); if (viewSelect) viewSelect.onchange = () => { ensure(); state.presentation.role = viewSelect.value; persist(); render(); };
    const show = document.querySelector('[data-show-marks]'); if (show) show.onchange = () => { state.presentation.showMarks = show.checked; persist(); paintMarks(); };
    document.querySelectorAll('[data-mark-note]').forEach(el => el.oninput = () => { const mark = state.annotations.find(a => a.id === el.dataset.markNote); if (mark) { mark.note = el.value; persist(); } });
    const notes = document.querySelector('[data-feedback-notes]'); if (notes) notes.oninput = () => { state.teacherNotes = notes.value; persist(); };
    document.querySelectorAll('[data-practiced]').forEach(el => el.onchange = () => { state.practiced[el.dataset.practiced] = el.checked; persist(); paintMarks(); });
    all('[data-delete-mark]', el => { state.annotations = state.annotations.filter(a => a.id !== el.dataset.deleteMark); delete state.practiced[el.dataset.deleteMark]; persist(); paintMarks(); openDrawer('feedback'); });
    all('[data-goto-mark]', el => { const mark = state.annotations.find(a => a.id === el.dataset.gotoMark); if (!mark) return; state.presentation.showMarks = true; for (const [area] of tabs) { const index = LESSONS[state.lesson]?.[area]?.findIndex(p => p.id === mark.pageId); if (index >= 0) { navigate(area, index); document.querySelector(`[data-mark="${mark.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); break; } } });
    all('[data-copy-invite]', async () => { const field = document.querySelector('#teacher-link'); try { await navigator.clipboard.writeText(field.value); notify('Teacher link copied.'); } catch { field.focus(); field.select(); showError('Copy the selected teacher link manually.'); } });
    all('[data-conflict-local]', () => { client?.resolve(true); openDrawer('live'); }); all('[data-conflict-server]', () => { client?.resolve(false); openDrawer('live'); }); all('[data-reconnect]', reconnect);
    all('[data-new-invite]', async () => { try { const value = token(); await api(`/${state.live.id}/invite`, { invitation: value }); state.live.invitation = value; saveLocal(); openDrawer('live'); } catch (e) { showError(e.message); } });
    all('[data-end-live]', async () => { try { capture(); if (client?.pending.length) { showError('Wait for pending edits to save, or download a backup first.'); return; } await api(`/${state.live.id}/close`, {}); beforeLeave(); delete state.live; persist(); closeDrawer(); render(); notify('Sharing ended. Your lesson and feedback remain here.'); } catch (e) { showError(e.message); } });
    all('[data-leave-live]', () => { beforeLeave(); welcome(); });
    const followInput = document.querySelector('[data-follow]'); if (followInput) followInput.onchange = () => { follow = followInput.checked; if (follow && client) client.accept({ session: client.remote, revision: client.revision }); };
    if (state?.live?.role === 'teacher') document.querySelectorAll('[data-draft], [data-option], [data-check], [data-save], [data-remove]').forEach(el => { el.disabled = true; if (el.tagName === 'TEXTAREA') el.title = 'The learner edits this response.'; });
  }
  function init() {
    document.addEventListener('pointerup', captureSelection); document.addEventListener('keyup', e => { if (e.key === 'Shift') captureSelection(); if (e.key === 'Escape') document.querySelector('.selection-action')?.remove(); });
    document.addEventListener('focusout', () => setTimeout(refreshViews, 0)); document.addEventListener('selectionchange', () => { if (!root.getSelection?.()?.toString()) refreshViews(); });
    root.addEventListener?.('pagehide', capture); root.addEventListener?.('online', () => client?.tick());
    const match = root.location?.hash.match(/^#room=([a-zA-Z0-9-]{8,100})&invite=([a-f0-9]{64})$/);
    if (match) { invitation = { id: match[1], token: match[2] }; history.replaceState(null, '', location.pathname + location.search); openDrawer('live'); openRoom(invitation.id, invitation.token); }
  }
  root.COLLAB = { ensure, toolbar, text, referencePage, selectionAnchor, paintMarks, feedbackBody, liveBody, cloudRooms, bind, init, changed, beforeLeave, reconnect, backup, restore, downloadBackup, sourceFor, capture, openRoom, createRoom, syncNow: async () => { capture(); await client?.tick(); } };
})(window);
