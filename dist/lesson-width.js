/* A local reading preference, independent of the shared lesson state. */
(function (root) {
  'use strict';
  const storageKey = 'sprachraum.lesson-width.v1', step = 80, stock = 1320, minimum = 760;
  let preference = null;
  try { const value = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (typeof value === 'number' && Number.isFinite(value) && value > 0) preference = value; } catch {}
  const viewport = () => root.innerWidth || stock;
  const clamp = value => Math.round(Math.min(viewport(), Math.max(Math.min(minimum, viewport()), value)));
  const current = () => clamp(preference ?? stock);
  function toolbar() {
    return `<div class="width-controls" role="group" aria-label="Lesson width"><span>Width</span><button type="button" data-width-narrow aria-label="Narrower lesson" aria-keyshortcuts="Control+Alt+ArrowLeft" title="Narrower · Ctrl+Alt+← · Shift-click for a larger step">−</button><output data-width-label aria-live="polite">${current()} px</output><button type="button" data-width-wider aria-label="Wider lesson" aria-keyshortcuts="Control+Alt+ArrowRight" title="Wider · Ctrl+Alt+→ · Shift-click for a larger step">+</button><button type="button" data-width-reset aria-keyshortcuts="Control+Alt+ArrowDown" title="Default width · Ctrl+Alt+↓">Reset</button></div>`;
  }
  function apply() {
    const style = document.documentElement.style;
    if (preference === null) { style.removeProperty('--lesson-width'); document.documentElement.removeAttribute('data-custom-width'); }
    else { style.setProperty('--lesson-width', current() + 'px'); document.documentElement.setAttribute('data-custom-width', ''); }
    document.querySelectorAll('[data-width-label]').forEach(el => { el.textContent = current() + ' px'; el.title = preference === null ? 'Default width' : 'Saved on this device'; });
    document.querySelectorAll('[data-width-narrow]').forEach(el => el.disabled = current() <= Math.min(minimum, viewport()));
    document.querySelectorAll('[data-width-wider]').forEach(el => el.disabled = current() >= viewport());
    document.querySelectorAll('[data-width-reset]').forEach(el => el.disabled = preference === null);
    root.PRONUNCIATION?.positionRemove();
  }
  function change(delta, large = false) {
    preference = clamp(current() + delta * step * (large ? 3 : 1));
    try { localStorage.setItem(storageKey, JSON.stringify(preference)); } catch {}
    apply();
  }
  function reset() { preference = null; try { localStorage.removeItem(storageKey); } catch {} apply(); }
  function mount() {
    apply();
    document.querySelectorAll('[data-width-narrow]').forEach(el => el.onclick = e => change(-1, e.shiftKey));
    document.querySelectorAll('[data-width-wider]').forEach(el => el.onclick = e => change(1, e.shiftKey));
    document.querySelectorAll('[data-width-reset]').forEach(el => el.onclick = reset);
  }
  function init() {
    document.addEventListener('keydown', e => {
      if (view !== 'session' || drawer || e.defaultPrevented || !e.ctrlKey || !e.altKey || e.metaKey || e.shiftKey || e.isComposing) return;
      const key = e.code || e.key;
      if (key === 'ArrowRight') change(1); else if (key === 'ArrowLeft') change(-1); else if (key === 'ArrowDown') reset(); else return;
      e.preventDefault(); e.stopPropagation();
    }, true);
    root.addEventListener('resize', apply);
  }
  root.LESSON_WIDTH = { toolbar, mount, init };
})(window);
