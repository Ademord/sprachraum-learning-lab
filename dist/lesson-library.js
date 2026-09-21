(function (root) {
  'use strict';
  const storageKey = 'sprachraum.lessons.v1';
  const records = new Map();
  const savedIds = new Set();
  let storageOK = true, recoveryNotice = '';
  const canonical = value => JSON.stringify(value, function (key, item) {
    return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
  });
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (raw !== null && (raw.version !== 1 || !Array.isArray(raw.lessons))) throw new Error('Unrecognized library');
    for (const record of raw?.lessons || []) {
      if (!record || typeof record !== 'object') { recoveryNotice = 'Some saved lessons could not be loaded. Re-import their JSON backups.'; continue; }
      const checked = LESSON_IO.validate(record.packet);
      if (!/^imported-[a-z0-9-]{8,80}$/.test(record.id) || !checked.ok || records.has(record.id)) { recoveryNotice = 'Some saved lessons could not be loaded. Re-import their JSON backups.'; continue; }
      const safe = { id: record.id, packet: checked.packet };
      records.set(safe.id, safe);
      savedIds.add(safe.id);
      LESSONS[safe.id] = LESSON_IO.normalize(safe.packet, safe.id);
    }
  } catch { storageOK = false; recoveryNotice = 'Your saved lesson library could not be read. New lessons will be kept for this visit; download a JSON backup.'; }
  // A damaged library is never overwritten implicitly.
  let writable = storageOK && !recoveryNotice;
  function add(input) {
    const checked = LESSON_IO.validate(input);
    if (!checked.ok) return checked;
    const match = [...records.values()].find(record => canonical(record.packet) === canonical(checked.packet));
    if (match) return { ...checked, id: match.id, duplicate: true, saved: savedIds.has(match.id) };
    const id = `imported-${root.crypto?.randomUUID?.() || Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)}`;
    records.set(id, { id, packet: checked.packet });
    LESSONS[id] = LESSON_IO.normalize(checked.packet, id);
    if (writable) {
      try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, lessons: [...records.values()] })); storageOK = true; for (const key of records.keys()) savedIds.add(key); }
      catch { storageOK = false; }
    } else storageOK = false;
    return { ...checked, id, duplicate: false, saved: storageOK };
  }
  function packet(id) { return records.get(id)?.packet || (Object.hasOwn(LESSONS, id) ? LESSON_IO.fromLesson(LESSONS[id]) : null); }
  root.LESSON_LIBRARY = { add, packet, isSaved: id => savedIds.has(id), get storageOK() { return storageOK; }, get recoveryNotice() { return recoveryNotice; }, get size() { return records.size; } };
})(window);
