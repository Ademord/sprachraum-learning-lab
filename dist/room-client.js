(function (root) {
  'use strict';
  const IO = root.SESSION_IO;
  class RoomClient {
    constructor({ id, role, session, revision, fetcher = root.fetch.bind(root), onSnapshot = () => {}, onStatus = () => {}, saveQueue = () => {}, pending = [] }) {
      Object.assign(this, { id, role, revision, fetcher, onSnapshot, onStatus, saveQueue });
      this.baseline = IO.clone(session); this.remote = IO.clone(session); this.pending = IO.clone(pending);
      // Restored edits may have reached the server before their acknowledgement was lost.
      this.attempted = new Set(this.pending.map(op => op.id));
      this.stopped = false; this.busy = false; this.conflict = null; this.failures = 0;
      for (const op of this.pending) this.baseline = IO.apply(this.baseline, op, 'owner', false);
    }
    status(text, kind = '') { this.onStatus({ text, kind, pending: this.pending.length, conflict: this.conflict }); }
    capture(session) {
      if (this.stopped) return;
      const changes = IO.diff(this.baseline, session, this.role, () => root.crypto.randomUUID());
      if (!changes.length) return;
      for (const change of changes) {
        const index = this.pending.findLastIndex(op => op.field === change.field && op.key === change.key);
        const previous = this.pending[index];
        // Only collapse edits that have never been sent. An uncertain retry must keep
        // exactly the same ID, compare-and-set value, and payload.
        if (previous && !this.attempted.has(previous.id)) {
          if (IO.equal(previous.before, change.value)) this.pending.splice(index, 1);
          else this.pending[index] = { ...previous, value: IO.clone(change.value) };
        } else this.pending.push(IO.clone(change));
      }
      this.baseline = IO.clone(session); this.saveQueue(this.pending);
      if (this.pending.length) this.status('Saving changes…', 'pending');
    }
    async request(path = '', options = {}) {
      const controller = new AbortController(); this.controller = controller;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await this.fetcher(`/api/rooms/${this.id}${path}`, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
        let data; try { data = await response.json(); } catch { throw new Error('The session service did not return JSON. Sign in again or retry.'); }
        return { response, data };
      } finally { clearTimeout(timeout); }
    }
    accept(data) {
      if (this.stopped || !data.session || data.revision < this.revision) return;
      this.revision = data.revision; this.remote = IO.clone(data.session);
      let projected = IO.clone(data.session);
      for (const op of this.pending) projected = IO.apply(projected, op, 'owner', false);
      this.baseline = projected; this.onSnapshot(IO.clone(projected), data);
    }
    async tick() {
      if (this.stopped || this.busy || this.conflict) return;
      this.busy = true;
      try {
        const sending = []; let batchBytes = 32;
        for (const op of this.pending.slice(0, 40)) { const size = new TextEncoder().encode(JSON.stringify(op)).length + 1; if (sending.length && batchBytes + size > 1400000) break; sending.push(op); batchBytes += size; }
        for (const op of sending) this.attempted.add(op.id);
        const { response, data } = await this.request(sending.length ? '/ops' : `?since=${this.revision}`, sending.length ? { method: 'POST', body: JSON.stringify({ operations: sending }) } : {});
        if (this.stopped) return;
        if (Array.isArray(data.acknowledged)) {
          const ids = new Set(data.acknowledged), remaining = this.pending.filter(op => !ids.has(op.id));
          if (remaining.length !== this.pending.length) { this.pending = remaining; for (const id of ids) this.attempted.delete(id); this.saveQueue(this.pending); }
        }
        if (!response.ok) {
          if (response.status === 409 && data.conflict) {
            this.accept(data); this.conflict = { message: data.error, operation: this.pending[0] };
            this.status(data.error, 'conflict'); return;
          }
          if ([400, 401, 403, 404, 410, 413].includes(response.status)) { this.conflict = { message: data.error, permanent: true }; this.status(data.error, 'blocked'); return; }
          throw new Error(data.error || 'Connection interrupted.');
        }
        this.accept(data); this.failures = 0;
        this.status(this.pending.length ? 'Saving changes…' : data.teacherJoined ? 'Shared session · up to date' : 'Shared session · waiting for teacher', this.pending.length ? 'pending' : 'connected');
      } catch (e) {
        if (!this.stopped) { this.failures++; this.status('Connection interrupted. Edits are kept here and will retry.', 'offline'); }
      } finally { this.busy = false; }
    }
    resolve(keepLocal) {
      if (!this.conflict || this.conflict.permanent) return;
      const op = this.conflict.operation;
      if (keepLocal) {
        const current = op.field === 'annotations' ? this.remote.annotations.find(a => a.id === op.key) || null : op.key === undefined ? this.remote[op.field] : this.remote[op.field][op.key] ?? null;
        this.pending = this.pending.map(item => item.id === op.id ? { ...item, before: IO.clone(current), id: root.crypto.randomUUID() } : item);
        this.attempted.delete(op.id);
      } else {
        this.pending = this.pending.filter(item => { const keep = item.field !== op.field || item.key !== op.key; if (!keep) this.attempted.delete(item.id); return keep; });
      }
      this.conflict = null; this.saveQueue(this.pending); this.accept({ session: this.remote, revision: this.revision }); this.status('Retrying…', 'pending');
    }
    start() {
      const run = async () => { if (this.stopped) return; await this.tick(); if (!this.stopped) this.timer = setTimeout(run, Math.min(10000, 1000 * 2 ** this.failures)); };
      run();
    }
    stop() { this.stopped = true; clearTimeout(this.timer); this.controller?.abort(); }
  }
  root.RoomClient = RoomClient;
})(typeof window !== 'undefined' ? window : globalThis);
