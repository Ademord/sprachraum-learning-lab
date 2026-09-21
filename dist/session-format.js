/* Portable learning state and operations, shared by the browser and room API. */
(function (root) {
  'use strict';
  const IO = root.LESSON_IO, areas = IO.areas, maxBytes = 1600000;
  const clone = x => JSON.parse(JSON.stringify(x));
  const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const visibleText = text => String(text || '').replace(/\[\[([^\]]+)\]\]/g, '$1');
  const insist = (condition, message) => { if (!condition) throw new Error(message); };
  const isObject = value => value && typeof value === 'object' && !Array.isArray(value);
  const safeKey = key => !['__proto__', 'constructor', 'prototype'].includes(key);
  const uid = value => typeof value === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(value);
  function parse(input) {
    let raw = typeof input === 'string' ? input : JSON.stringify(input);
    insist(typeof raw === 'string' && IO.bytes(raw) <= maxBytes, 'Session file: maximum size is 1.6 MB.');
    raw = raw.replace(/^\uFEFF/, '').trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1');
    return JSON.parse(raw, (key, value) => { insist(safeKey(key), 'Unsafe object key.'); return value; });
  }
  function allPages(packet) { return areas.flatMap(area => packet.lesson.areas[area].map(p => ({ ...p, area }))); }
  function block(packet, pageId, path, raw = false) {
    const page = allPages(packet).find(p => p.id === pageId);
    if (!page || typeof path !== 'string') return null;
    const parts = path.split(':'); let value;
    if (parts[0] === 'original' && parts.length === 1) value = page.original;
    else if (['paragraphs', 'reference'].includes(parts[0]) && parts.length === 2 && /^\d+$/.test(parts[1])) {
      const paragraphs = parts[0] === 'reference' && page.referenceId ? allPages(packet).find(p => p.id === page.referenceId)?.paragraphs : page[parts[0]];
      value = paragraphs?.[Number(parts[1])];
    } else if (['lines', 'words', 'patterns', 'phrases', 'tones'].includes(parts[0]) && parts.length === 3 && /^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) value = page[parts[0]]?.[Number(parts[1])]?.[Number(parts[2])];
    return typeof value === 'string' ? raw ? value : visibleText(value) : null;
  }
  function empty(topic = '') {
    return { topic, tab: 'reading', pages: {}, drafts: {}, extraDrafts: {}, saved: [], tones: {}, checks: {}, reveals: {}, annotations: [], practiced: {}, teacherNotes: '', presentation: { role: 'learner', showMarks: false } };
  }
  function validateState(packet, value) {
    insist(isObject(value), 'session must be an object.');
    const defaults = empty(packet.lesson.topic);
    for (const key of Object.keys(value)) insist(Object.hasOwn(defaults, key), `session.${key} is not supported.`);
    const s = { ...defaults, ...clone(value) };
    const list = allPages(packet), byId = new Map(list.map(p => [p.id, p]));
    insist(typeof s.topic === 'string' && s.topic.length <= 1000, 'session.topic must be text up to 1,000 characters.');
    insist(areas.includes(s.tab), 'session.tab must name a lesson area.');
    const map = (name, check, max = 200) => {
      insist(isObject(s[name]) && Object.keys(s[name]).length <= max, `session.${name} must be a small object.`);
      for (const [k, v] of Object.entries(s[name])) insist(safeKey(k) && check(v, k), `session.${name}.${k} has an invalid value or page reference.`);
    };
    map('pages', (v, k) => areas.includes(k) && Number.isInteger(v) && v >= 0 && v < packet.lesson.areas[k].length, 6);
    map('drafts', (v, k) => byId.has(k) && typeof v === 'string' && v.length <= 100000);
    map('extraDrafts', (v, k) => k.length <= 300 && typeof v === 'string' && v.length <= 100000);
    map('tones', (v, k) => byId.get(k)?.tones?.some(t => t[0] === v));
    map('reveals', (v, k) => byId.has(k) && typeof v === 'boolean');
    map('checks', (v, k) => isObject(v) && byId.get(k)?.check && Object.keys(v).every(key => ['selected', 'checked', 'attempts'].includes(key)) && Number.isInteger(v.selected) && v.selected >= 0 && v.selected < byId.get(k).check.options.length && (v.checked === undefined || typeof v.checked === 'boolean') && (v.attempts === undefined || Number.isInteger(v.attempts) && v.attempts >= 0 && v.attempts <= 100000));
    insist(Array.isArray(s.saved) && s.saved.length <= 300, 'session.saved must contain up to 300 kept phrases.');
    s.saved.forEach(n => insist(isObject(n) && Object.keys(n).every(k => ['text', 'area', 'page'].includes(k)) && typeof n.text === 'string' && n.text.length <= 18000 && typeof n.page === 'string' && n.page.length <= 240 && areas.includes(n.area), 'A saved phrase has an invalid text, area or page label.'));
    insist(typeof s.teacherNotes === 'string' && s.teacherNotes.length <= 100000, 'Teacher notes are limited to 100,000 characters.');
    insist(isObject(s.presentation) && ['learner', 'teacher'].includes(s.presentation.role) && typeof s.presentation.showMarks === 'boolean' && Object.keys(s.presentation).every(k => ['role', 'showMarks'].includes(k)), 'session.presentation is invalid.');
    insist(Array.isArray(s.annotations) && s.annotations.length <= 500, 'A session may contain up to 500 marks.');
    const ids = new Set();
    for (const a of s.annotations) {
      insist(isObject(a) && Object.keys(a).every(k => ['id', 'pageId', 'block', 'start', 'end', 'quote', 'note'].includes(k)), 'A pronunciation mark has unsupported fields.');
      insist(uid(a.id) && !ids.has(a.id), 'Pronunciation mark IDs must be unique.'); ids.add(a.id);
      const text = block(packet, a.pageId, a.block);
      insist(text !== null && Number.isInteger(a.start) && Number.isInteger(a.end) && a.start >= 0 && a.end > a.start && a.end <= text.length && a.end - a.start <= 500 && text.slice(a.start, a.end) === a.quote, `Pronunciation mark ${a.id} does not match its original text. No highlight was guessed.`);
      insist(typeof a.note === 'string' && a.note.length <= 4000, 'A pronunciation note may contain up to 4,000 characters.');
    }
    map('practiced', (v, k) => ids.has(k) && typeof v === 'boolean', 500);
    insist(IO.bytes(JSON.stringify({ lesson: packet, session: s })) <= maxBytes, 'Session is too large to save. Maximum: 1.6 MB.');
    return s;
  }
  function validate(input) {
    try {
      const envelope = parse(input);
      insist(envelope?.format === 'sprachraum.session' && envelope.version === 1, 'Expected a sprachraum.session file, version 1.');
      insist(Object.keys(envelope).every(k => ['format', 'version', 'exportedAt', 'lesson', 'session'].includes(k)), 'Session file contains an unsupported field.');
      if (envelope.exportedAt !== undefined) insist(typeof envelope.exportedAt === 'string' && !Number.isNaN(Date.parse(envelope.exportedAt)), 'Invalid export date.');
      const checked = IO.validate(envelope.lesson);
      insist(checked.ok, checked.errors.join('\n'));
      const session = validateState(checked.packet, envelope.session);
      return { ...checked, isSession: true, session, envelope: { format: 'sprachraum.session', version: 1, exportedAt: envelope.exportedAt || new Date().toISOString(), lesson: checked.packet, session } };
    } catch (e) { return { ok: false, isSession: true, repairable: false, errors: [e instanceof SyntaxError ? 'Session JSON is incomplete or malformed.' : e.message], warnings: [] }; }
  }
  function inspect(input) {
    try { const data = parse(input); return data?.format === 'sprachraum.session' ? validate(data) : IO.validate(data); }
    catch (e) { return { ok: false, ...(typeof input === 'string' && input.includes('sprachraum.session') ? { repairable: false, isSession: true } : {}), errors: [e instanceof SyntaxError ? 'JSON is incomplete or malformed.' : e.message], warnings: [] }; }
  }
  function maps(runtimeLesson, packet) {
    const toPortable = new Map(), toRuntime = new Map();
    for (const area of areas) runtimeLesson[area].forEach((p, i) => { const id = packet.lesson.areas[area][i]?.id; if (id) { toPortable.set(p.id || `${area}:${i}`, id); toRuntime.set(id, p.id || `${area}:${i}`); } });
    return { toPortable, toRuntime };
  }
  function exportState(state, runtimeLesson, packet) {
    const { toPortable } = maps(runtimeLesson, packet), s = empty(state.topic);
    s.tab = state.tab; s.pages = clone(state.pages || {}); s.saved = clone(state.saved || []);
    for (const [key, value] of Object.entries(state.drafts || {})) (toPortable.has(key) ? s.drafts : s.extraDrafts)[toPortable.get(key) || key] = value;
    for (const field of ['tones', 'checks', 'reveals']) for (const [key, value] of Object.entries(state[field] || {})) if (toPortable.has(key)) s[field][toPortable.get(key)] = clone(value);
    s.annotations = (state.annotations || []).map(a => ({ ...clone(a), pageId: toPortable.get(a.pageId) || a.pageId }));
    s.practiced = clone(state.practiced || {}); s.teacherNotes = state.teacherNotes || '';
    s.presentation = { role: state.presentation?.role || 'learner', showMarks: !!state.presentation?.showMarks };
    return { format: 'sprachraum.session', version: 1, exportedAt: new Date().toISOString(), lesson: packet, session: validateState(packet, s) };
  }
  function importState(s, runtimeLesson, packet, id, lessonId) {
    const { toRuntime } = maps(runtimeLesson, packet);
    const result = { id, lesson: lessonId, topic: s.topic, tab: s.tab, pages: clone(s.pages), drafts: clone(s.extraDrafts), saved: clone(s.saved), tones: {}, checks: {}, reveals: {}, teacherNotes: s.teacherNotes, presentation: clone(s.presentation), practiced: clone(s.practiced) };
    for (const field of ['drafts', 'tones', 'checks', 'reveals']) for (const [key, value] of Object.entries(s[field])) result[field][toRuntime.get(key)] = clone(value);
    result.annotations = s.annotations.map(a => ({ ...clone(a), pageId: toRuntime.get(a.pageId) }));
    return result;
  }
  // Field-level compare-and-set prevents whole-session overwrites and stale resurrection.
  const mapped = ['drafts', 'extraDrafts', 'tones', 'checks', 'reveals', 'practiced'];
  const scalar = ['saved', 'teacherNotes', 'tab', 'pages'];
  function apply(snapshot, op, role, strict = true) {
    insist(isObject(op) && uid(op.id) && typeof op.field === 'string' && Object.keys(op).every(k => ['id', 'field', 'key', 'before', 'value'].includes(k)), 'Invalid operation.');
    const teacherField = op.field === 'annotations' || op.field === 'teacherNotes';
    insist(role === 'owner' || (role === 'teacher' ? teacherField : role === 'learner' && !teacherField), 'This role cannot edit that field.');
    const next = clone(snapshot); let previous;
    if (op.field === 'practiced' && !next.annotations.some(a => a.id === op.key)) { delete next.practiced[op.key]; return next; }
    if (op.field === 'annotations') { insist(uid(op.key), 'Invalid mark ID.'); previous = next.annotations.find(a => a.id === op.key) || null; }
    else if (mapped.includes(op.field)) { insist(typeof op.key === 'string' && op.key.length <= 300 && safeKey(op.key), 'Invalid field key.'); previous = next[op.field][op.key] ?? null; }
    else { insist(scalar.includes(op.field) && op.key === undefined, 'Unsupported operation field.'); previous = next[op.field]; }
    if (strict && !equal(previous, op.before) && !equal(previous, op.value)) { const e = new Error(`Another edit changed ${op.field}. Your pending version has been kept.`); e.conflict = true; throw e; }
    if (op.field === 'annotations') {
      insist(op.value === null || isObject(op.value) && op.value.id === op.key, 'Mark ID mismatch.');
      next.annotations = next.annotations.filter(a => a.id !== op.key);
      if (op.value !== null) next.annotations.push(clone(op.value)); else delete next.practiced[op.key];
    } else if (mapped.includes(op.field)) { if (op.value === null) delete next[op.field][op.key]; else next[op.field][op.key] = clone(op.value); }
    else next[op.field] = clone(op.value);
    return next;
  }
  function diff(before, after, role, makeId) {
    const changes = [], emit = (field, key, old, value) => { if (!equal(old, value)) changes.push({ id: makeId(), field, ...(key === undefined ? {} : { key }), before: old ?? null, value: value ?? null }); };
    if (role !== 'learner') {
      const old = new Map(before.annotations.map(a => [a.id, a])), fresh = new Map(after.annotations.map(a => [a.id, a]));
      for (const key of new Set([...old.keys(), ...fresh.keys()])) emit('annotations', key, old.get(key), fresh.get(key));
      emit('teacherNotes', undefined, before.teacherNotes, after.teacherNotes);
    }
    if (role !== 'teacher') {
      for (const field of mapped) for (const key of new Set([...Object.keys(before[field]), ...Object.keys(after[field])])) emit(field, key, before[field][key], after[field][key]);
      for (const field of scalar.filter(f => f !== 'teacherNotes')) emit(field, undefined, before[field], after[field]);
    }
    return changes;
  }
  root.SESSION_IO = { maxBytes, empty, validate, inspect, validateState, parse, maps, exportState, importState, visibleText, block, apply, diff, clone, equal, uid };
})(typeof window !== 'undefined' ? window : globalThis);
