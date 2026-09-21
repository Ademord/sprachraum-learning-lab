/* In-text pronunciation marking and the non-modal review rail. */
(function (root) {
  'use strict';
  const IO = root.SESSION_IO;
  let context = '', marking = false, panel = false, active = null, lastPage = '', undo = null;
  let pointer = null, dragging = false, suppressClick = false, keyboardStart = null;
  const teacher = () => state?.presentation?.role === 'teacher';
  const visible = () => teacher() || !!state?.presentation?.showMarks;
  const words = value => [...value.matchAll(/[\p{L}\p{M}\p{N}]+(?:[’'–-][\p{L}\p{M}\p{N}]+)*/gu)].map(m => ({ start: m.index, end: m.index + m[0].length, text: m[0] }));
  function ensure() {
    const next = `${state?.id}:${teacher()}`;
    if (context !== next) { context = next; marking = teacher(); panel = teacher() || visible(); active = null; lastPage = ''; undo = null; keyboardStart = null; }
  }
  function controls() {
    ensure();
    return `<div class="pron-modes" role="group" aria-label="Reading and pronunciation"><button data-pron-read aria-pressed="${!panel}">Read</button><button data-pron-mode aria-pressed="${panel}">${teacher() ? 'Mark words' : 'Review pronunciation'}<span class="pron-count" data-mark-count>${state.annotations.length}</span></button></div>`;
  }
  function wordHTML(clean, start, end) {
    const part = clean.slice(start, end);
    if (!teacher() || !marking) return esc(part);
    let cursor = 0;
    return words(part).map(w => {
      const html = esc(part.slice(cursor, w.start)) + `<span class="pron-word" role="button" tabindex="-1" data-pron-word data-start="${start + w.start}" data-end="${start + w.end}" aria-label="Mark ${esc(w.text)}">${esc(w.text)}</span>`;
      cursor = w.end; return html;
    }).join('') + esc(part.slice(cursor));
  }
  function html(text, pageId, block) {
    ensure();
    const clean = IO.visibleText(text), marks = visible() ? (state.annotations || []).filter(a => a.pageId === pageId && a.block === block && clean.slice(a.start, a.end) === a.quote) : [];
    if (!marks.length && (!teacher() || !marking)) return markup(text);
    const cuts = [...new Set([0, clean.length, ...marks.flatMap(a => [a.start, a.end])])].sort((a, b) => a - b);
    return cuts.slice(0, -1).map((start, i) => {
      const covering = marks.filter(a => a.start <= start && a.end >= cuts[i + 1]);
      const mark = covering.find(a => a.id === active) || covering[0];
      const segment = wordHTML(clean, start, cuts[i + 1]);
      return mark ? `<mark role="button" tabindex="${teacher() && marking ? '-1' : '0'}" class="pronunciation-mark ${state.practiced[mark.id] ? 'practiced' : ''} ${mark.id === active && panel ? 'active-mark' : ''}" data-mark="${esc(mark.id)}" aria-label="${esc(mark.quote)}. ${state.practiced[mark.id] ? 'Practised. ' : ''}Open pronunciation note">${segment}</mark>` : segment;
    }).join('');
  }
  function paint() {
    if (!state || view !== 'session') return;
    ensure();
    // Never replace text nodes under an active pointer selection.
    if (dragging || root.getSelection?.()?.toString()) return;
    const { packet, runtime } = COLLAB.sourceFor(); const ids = IO.maps(runtime, packet).toPortable;
    const focus = document.activeElement?.closest('[data-pron-word]');
    const focused = focus && { page: focus.closest('[data-annotatable]').dataset.pageId, block: focus.closest('[data-annotatable]').dataset.block, start: focus.dataset.start };
    document.querySelectorAll('[data-annotatable]').forEach(el => {
      const content = IO.block(packet, ids.get(el.dataset.pageId), el.dataset.block, true);
      if (content === null) return;
      const output = html(content, el.dataset.pageId, el.dataset.block);
      if (el.innerHTML !== output) el.innerHTML = output;
      el.querySelectorAll('[data-word]').forEach(word => word.onclick = () => openDrawer('word', word.dataset.word));
    });
    const targets = [...document.querySelectorAll('[data-pron-word]')];
    targets.forEach(el => el.tabIndex = -1);
    const target = focused && targets.find(el => el.dataset.start === focused.start && el.closest('[data-annotatable]').dataset.pageId === focused.page && el.closest('[data-annotatable]').dataset.block === focused.block);
    if (targets.length) (target || targets[0]).tabIndex = 0;
    if (target && focus !== target) target.focus({ preventScroll: true });
    document.querySelectorAll('[data-mark-count]').forEach(el => el.textContent = state.annotations.length);
    refresh();
  }
  function anchor(element, start, end) {
    const clean = element.textContent;
    while (start < end && /\s/u.test(clean[start])) start++;
    while (end > start && /\s/u.test(clean[end - 1])) end--;
    if (end <= start || end - start > 500) return null;
    return { pageId: element.dataset.pageId, block: element.dataset.block, start, end, quote: clean.slice(start, end) };
  }
  function selectionAnchors() {
    const selection = root.getSelection?.();
    if (!selection?.rangeCount || selection.isCollapsed) return [];
    const range = selection.getRangeAt(0);
    const start = (range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement)?.closest('[data-annotatable]');
    const end = (range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement)?.closest('[data-annotatable]');
    if (!start || !end || !start.isConnected || !end.isConnected) return [];
    const result = [];
    for (const el of document.querySelectorAll('[data-annotatable]')) {
      if (!range.intersectsNode(el)) continue;
      let from = 0, to = el.textContent.length;
      if (el === start) { const before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.startContainer, range.startOffset); from = before.toString().length; }
      if (el === end) { const before = range.cloneRange(); before.selectNodeContents(el); before.setEnd(range.endContainer, range.endOffset); to = before.toString().length; }
      // Partial drags snap to complete words without changing their stored offsets.
      for (const w of words(el.textContent)) { if (from > w.start && from < w.end) from = w.start; if (to > w.start && to < w.end) to = w.end; }
      const value = anchor(el, from, to);
      if (value) result.push(value); else if (to > from) { notify('Select a shorter phrase, up to 500 characters.'); return []; }
    }
    return result;
  }
  function add(anchors) {
    if (!teacher() || !marking || !anchors.length) return;
    const added = []; let target;
    for (const a of anchors) {
      const existing = state.annotations.find(m => m.pageId === a.pageId && m.block === a.block && m.start === a.start && m.end === a.end);
      target = existing || { id: crypto.randomUUID(), ...a, note: '' };
      if (!existing) { state.annotations.push(target); added.push(target); }
    }
    try { COLLAB.backup(); } catch (e) { state.annotations = state.annotations.filter(a => !added.includes(a)); notify(e.message); return; }
    undo = added.length ? { type: 'add', marks: added, message: added.length === 1 ? `Marked “${target.quote}”` : `Marked ${added.length} phrases` } : undo;
    active = target.id; panel = true; keyboardStart = null;
    root.getSelection?.()?.removeAllRanges(); persist(); paint();
  }
  function ordered() {
    const pageOrder = tabs.flatMap(([area]) => LESSONS[state.lesson]?.[area] || []).map(p => p.id);
    return [...state.annotations].sort((a,b) => pageOrder.indexOf(a.pageId) - pageOrder.indexOf(b.pageId) || a.block.localeCompare(b.block, undefined, { numeric: true }) || a.start - b.start || a.end - b.end);
  }
  function locationLabel(a) {
    const page = draftLabel(a.pageId), paragraph = a.block.match(/^(?:paragraphs|reference):(\d+)$/);
    return page + (paragraph ? ` · ¶${Number(paragraph[1]) + 1}` : '');
  }
  function currentMark() {
    const list = ordered();
    return list.find(a => a.id === active) || null;
  }
  function contextHTML(a) {
    const { packet, runtime } = COLLAB.sourceFor();
    const clean = IO.block(packet, IO.maps(runtime, packet).toPortable.get(a.pageId), a.block) || '';
    const from = Math.max(0, a.start - 65), to = Math.min(clean.length, a.end + 65);
    return `${from ? '…' : ''}${esc(clean.slice(from, a.start))}<strong>${esc(a.quote)}</strong>${esc(clean.slice(a.end, to))}${to < clean.length ? '…' : ''}`;
  }
  function railHTML() {
    const list = ordered(), mark = currentMark(), index = list.findIndex(a => a.id === active), done = list.filter(a => state.practiced[a.id]).length;
    return `<div class="pron-rail-head"><h3>Pronunciation</h3><button class="pron-icon-button" data-pron-close aria-label="Close pronunciation and return to lesson">×</button></div>
      <div class="pron-rail-status"><span>${teacher() ? `${list.length} ${list.length === 1 ? 'mark' : 'marks'}` : `${done} of ${list.length} practised`}</span><span>${teacher() ? 'Learner reveals when ready' : 'Read aloud together'}</span></div><div class="pron-selection" data-pron-selection hidden></div>
      ${undo && teacher() ? `<div class="pron-undo" role="status"><span>${esc(undo.message)}</span><button data-pron-undo>Undo</button></div>` : ''}
      ${mark ? `<div class="pron-focus" data-focus-id="${esc(mark.id)}"><div class="pron-step"><span>Word ${index + 1} of ${list.length}</span><div><button data-pron-prev class="pron-icon-button" aria-label="Previous mark" ${index <= 0 ? 'disabled' : ''}>←</button><button data-pron-next class="pron-icon-button" aria-label="Next mark" ${index >= list.length - 1 ? 'disabled' : ''}>→</button></div></div><h4 lang="de">${esc(mark.quote)}</h4><p class="pron-context" lang="de">${contextHTML(mark)}</p><button class="pron-location" data-pron-locate>${esc(locationLabel(mark))} ↗</button>
      ${teacher() ? `<label for="pron-hint">Pronunciation note <span>optional</span></label><textarea id="pron-hint" data-mark-note="${esc(mark.id)}" maxlength="4000" rows="3" placeholder="e.g. Stress the second syllable">${esc(mark.note)}</textarea><div class="pron-note-footer"><span data-pron-saved>${sessionSaved() ? 'Saved automatically' : 'Keep this tab open · storage unavailable'}</span><button data-delete-mark="${esc(mark.id)}">Remove</button></div>` : `<p class="pron-note">${esc(mark.note || 'Say it once on its own, then in the sentence.')}</p><button class="pron-practise ${state.practiced[mark.id] ? 'done' : ''}" data-pron-practise aria-pressed="${!!state.practiced[mark.id]}">${state.practiced[mark.id] ? '✓ Practised' : 'Mark as practised'}</button>`}</div>` : `<div class="pron-empty"><span class="pron-empty-sample" lang="de">miteinander</span><h4>${teacher() ? 'Mark while you listen' : list.length ? 'Choose a marked word' : 'Read at your own pace'}</h4><p>${teacher() ? 'Click or tap a word in the text. Drag across several words to mark a phrase.' : list.length ? 'Choose one below to review it in the text.' : 'Your teacher’s marks will appear here when they add them.'}</p>${teacher() ? '<p class="pron-key-help">Keyboard: Tab into the text, use arrow keys, then Enter. Shift + arrows selects a phrase.</p>' : ''}</div>`}
      ${list.length ? `<details class="pron-queue" ${!mark ? 'open' : ''}><summary>All marks <span>${list.length}</span></summary><div>${list.map(a => `<button data-pron-open="${esc(a.id)}" aria-current="${a.id === active ? 'true' : 'false'}"><span lang="de">${esc(a.quote)}</span><small>${esc(locationLabel(a))}</small>${state.practiced[a.id] ? '<span class="pron-done-label">Practised</span>' : ''}</button>`).join('')}</div></details>` : ''}
      <details class="pron-general"><summary>Lesson notes</summary>${teacher() ? `<label class="sr-only" for="pron-lesson-notes">Teacher’s lesson notes</label><textarea id="pron-lesson-notes" data-feedback-notes maxlength="100000" rows="4" placeholder="Notes for the whole lesson">${esc(state.teacherNotes)}</textarea>` : `<p class="pron-note">${esc(state.teacherNotes || 'No lesson notes yet.')}</p>`}</details>`;
  }
  function refresh(force = false) {
    const rail = document.querySelector('[data-pron-rail]'); if (!rail) return;
    document.querySelector('.activity').hidden = panel;
    rail.hidden = !panel; document.querySelector('.canvas')?.classList.toggle('pronunciation-open', panel);
    document.querySelectorAll('[data-pron-read]').forEach(el => el.setAttribute('aria-pressed', String(!panel)));
    document.querySelectorAll('[data-pron-mode]').forEach(el => el.setAttribute('aria-pressed', String(panel)));
    if (!panel) return;
    if (!force && rail.contains(document.activeElement) && document.activeElement.matches('textarea')) {
      if (!active || state.annotations.some(a => a.id === active)) return;
    }
    const output = railHTML();
    if (rail._pronHTML === output) return;
    const focused = rail.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.id;
    const focusData = focused && [...focused.attributes].find(attr => attr.name.startsWith('data-'));
    const details = [...rail.querySelectorAll('details')].map(el => el.open);
    rail.innerHTML = output; rail._pronHTML = output;
    rail.querySelectorAll('details').forEach((el,i) => { if (details[i] !== undefined) el.open = details[i]; });
    bindRail(rail);
    const nextFocus = focusId ? rail.querySelector('#' + focusId) : focusData ? [...rail.querySelectorAll('[' + focusData.name + ']')].find(el => el.getAttribute(focusData.name) === focusData.value) : null;
    if (nextFocus) nextFocus.focus({ preventScroll: true });
  }
  function mount() {
    if (!state || view !== 'session') return;
    ensure();
    const page = key();
    if (lastPage !== page) { if (!state.annotations.some(a => a.id === active && a.pageId === page)) active = ordered().find(a => a.pageId === page)?.id || null; lastPage = page; keyboardStart = null; pointer = null; dragging = false; root.getSelection?.()?.removeAllRanges(); }
    const grid = document.querySelector('.canvas-grid');
    if (grid && !grid.querySelector('[data-pron-rail]')) grid.insertAdjacentHTML('beforeend', '<aside class="pron-rail" data-pron-rail aria-label="Pronunciation review" hidden></aside>');
    const material = document.querySelector('.material');
    if (material) {
      material.classList.toggle('marking-words', teacher() && marking);
      material.querySelector('[data-pron-instruction]')?.remove();
      if (teacher() && marking) material.querySelector('#page-title')?.insertAdjacentHTML('afterend', '<p class="pron-instruction" data-pron-instruction><span class="pron-pen" aria-hidden="true">✎</span> Click a word to mark it. Drag to mark a phrase.</p>');
    }
    paint(); updateSelection();
    document.querySelectorAll('[data-pron-read]').forEach(el => el.onclick = () => close());
    document.querySelectorAll('[data-pron-mode]').forEach(el => el.onclick = () => open());
  }
  function open(id, locate = false) {
    closeDrawer(false); ensure(); panel = true; marking = teacher(); root.getSelection?.()?.removeAllRanges();
    if (!teacher()) { state.presentation.showMarks = true; persist(); }
    if (id) active = id; else if (!currentMark()) active = ordered().find(a => a.pageId === key())?.id || ordered()[0]?.id || null;
    if (locate && currentMark()) goTo(currentMark());
    else { mount(); }
  }
  function close() {
    panel = false; marking = false; keyboardStart = null; root.getSelection?.()?.removeAllRanges();
    if (!teacher()) { state.presentation.showMarks = false; persist(); }
    mount(); document.querySelector('[data-pron-read]')?.focus({ preventScroll: true });
  }
  function goTo(mark) {
    active = mark.id;
    let target = [...document.querySelectorAll('[data-mark]')].find(el => el.dataset.mark === mark.id);
    if (!target) {
      for (const [area] of tabs) { const i = LESSONS[state.lesson]?.[area]?.findIndex(p => p.id === mark.pageId); if (i >= 0) { navigate(area, i); break; } }
    }
    paint(); target = [...document.querySelectorAll('[data-mark]')].find(el => el.dataset.mark === mark.id);
    if (target) { const details = target.closest('details'); if (details) details.open = true; target.scrollIntoView({ block: 'center', behavior: root.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }
  }
  function undoLast() {
    if (!undo || !teacher()) return;
    const action = undo;
    if (action.type === 'add') { const ids = action.marks.map(a => a.id); state.annotations = state.annotations.filter(a => !ids.includes(a.id)); ids.forEach(id => delete state.practiced[id]); }
    else { for (const mark of action.marks) if (!state.annotations.some(a => a.id === mark.id)) state.annotations.push(mark); if (action.practiced) state.practiced[action.marks[0].id] = true; }
    undo = null; active = action.type === 'remove' ? action.marks[0].id : null; persist(); paint();
  }
  function bindRail(rail) {
    const on = (selector, fn) => rail.querySelectorAll(selector).forEach(el => el.onclick = () => fn(el));
    on('[data-pron-close]', close); on('[data-pron-undo]', undoLast);
    on('[data-pron-open]', el => open(el.dataset.pronOpen, true));
    on('[data-pron-locate]', () => { if (currentMark()) goTo(currentMark()); });
    const step = delta => { const list = ordered(), i = list.findIndex(a => a.id === active); if (list[i + delta]) open(list[i + delta].id, true); };
    on('[data-pron-prev]', () => step(-1)); on('[data-pron-next]', () => step(1));
    on('[data-delete-mark]', el => {
      if (!teacher()) return;
      const mark = state.annotations.find(a => a.id === el.dataset.deleteMark); if (!mark) return;
      undo = { type: 'remove', marks: [IO.clone(mark)], practiced: !!state.practiced[mark.id], message: `Removed “${mark.quote}”` };
      const list = ordered(), i = list.indexOf(mark); active = (list[i + 1] || list[i - 1])?.id || null;
      state.annotations = state.annotations.filter(a => a.id !== mark.id); delete state.practiced[mark.id]; persist(); paint();
    });
    on('[data-pron-practise]', () => { const mark = currentMark(); if (!mark || teacher()) return; state.practiced[mark.id] = !state.practiced[mark.id]; persist(); paint(); rail.querySelector('[data-pron-practise]')?.focus({ preventScroll: true }); });
    rail.querySelectorAll('[data-mark-note]').forEach(el => el.oninput = () => { const mark = state.annotations.find(a => a.id === el.dataset.markNote); if (mark && teacher()) { mark.note = el.value; persist(); rail.querySelector('[data-pron-saved]').textContent = sessionSaved() ? 'Saved automatically' : 'Keep this tab open · storage unavailable'; } });
    const notes = rail.querySelector('[data-feedback-notes]'); if (notes) notes.oninput = () => { if (teacher()) { state.teacherNotes = notes.value; persist(); } };
  }
  function updateSelection() {
    const box = document.querySelector('[data-pron-selection]');
    if (!box || !teacher() || !marking || dragging || drawer) return;
    const anchors = selectionAnchors(); box.hidden = !anchors.length;
    if (!anchors.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<p lang="de">${esc(anchors.map(a => a.quote).join(' … '))}</p><button data-pron-add-selection>Mark selected phrase</button>`;
    const button = box.querySelector('button'); button.onpointerdown = e => e.preventDefault(); button.onclick = () => { suppressClick = false; add(anchors); };
  }
  function init() {
    document.addEventListener('pointerdown', e => { pointer = null; dragging = false; if ((e.button === undefined || e.button === 0) && e.target.closest('[data-annotatable]') && teacher() && marking && !drawer) { pointer = { x: e.clientX, y: e.clientY, type: e.pointerType }; dragging = true; suppressClick = false; } });
    document.addEventListener('pointerup', e => {
      const startedInText = !!pointer;
      const moved = pointer && (Math.abs(e.clientX - pointer.x) > 7 || Math.abs(e.clientY - pointer.y) > 7);
      const touch = pointer?.type === 'touch', touchScroll = touch && moved;
      dragging = false; pointer = null;
      if (startedInText && teacher() && marking && view === 'session' && !drawer) {
        const anchors = selectionAnchors();
        if (anchors.length && touch) { suppressClick = true; updateSelection(); }
        else if (anchors.length && !touchScroll) { suppressClick = true; add(anchors); }
        else if (moved) suppressClick = true;
      }
    });
    document.addEventListener('pointercancel', () => { dragging = false; pointer = null; suppressClick = true; });
    document.addEventListener('selectionchange', () => { updateSelection(); if (!dragging && !root.getSelection?.()?.toString()) paint(); });
    document.addEventListener('click', e => {
      const text = e.target.closest('[data-annotatable]'); if (!text || drawer || view !== 'session') return;
      if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
      const mark = e.target.closest('[data-mark]');
      if (mark) { e.preventDefault(); open(mark.dataset.mark); return; }
      const word = e.target.closest('[data-pron-word]');
      if (word && teacher() && marking) { e.preventDefault(); add([anchor(text, Number(word.dataset.start), Number(word.dataset.end))]); }
    });
    document.addEventListener('keydown', e => {
      if (e.defaultPrevented || drawer || view !== 'session') return;
      const editable = e.target.matches('textarea,input,select,[contenteditable="true"]');
      if (editable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && undo && teacher()) { e.preventDefault(); undoLast(); return; }
      if (e.key === 'Escape') { keyboardStart = null; root.getSelection?.()?.removeAllRanges(); if (panel) close(); return; }
      const word = e.target.closest('[data-pron-word]'), mark = e.target.closest('[data-mark]');
      if (word && teacher() && marking) {
        const targets = [...document.querySelectorAll('[data-pron-word]')], index = targets.indexOf(word);
        const direction = ['ArrowRight','ArrowDown'].includes(e.key) ? 1 : ['ArrowLeft','ArrowUp'].includes(e.key) ? -1 : 0;
        if (direction) {
          e.preventDefault(); if (e.shiftKey) keyboardStart ||= word; else keyboardStart = null;
          const next = targets[index + direction]; if (next) { word.tabIndex = -1; next.tabIndex = 0; next.focus();
            if (keyboardStart) { const first = targets.indexOf(keyboardStart) <= targets.indexOf(next) ? keyboardStart : next, last = first === next ? keyboardStart : next; const range = document.createRange(); range.setStartBefore(first); range.setEndAfter(last); root.getSelection().removeAllRanges(); root.getSelection().addRange(range); }
          } return;
        }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const selected = keyboardStart && selectionAnchors(); if (selected?.length) add(selected); else if (mark) open(mark.dataset.mark); else add([anchor(word.closest('[data-annotatable]'), Number(word.dataset.start), Number(word.dataset.end))]); }
      } else if (mark && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(mark.dataset.mark); }
    });
    document.addEventListener('focusout', e => { if (e.target.closest('[data-pron-rail]')) setTimeout(() => refresh(), 0); });
  }
  function reset() { context = ''; active = null; lastPage = ''; undo = null; dragging = false; pointer = null; suppressClick = false; keyboardStart = null; }
  root.PRONUNCIATION = { controls, html, paint, mount, open, reset, init, selectionAnchors };
})(window);
