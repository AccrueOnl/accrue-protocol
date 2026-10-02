import { isReduced } from './motion.js';

const state = new WeakMap();
const easeOutCubic = (e) => 1 - Math.pow(1 - e, 3);

function settle(el) {
  el.querySelector('.skeleton')?.remove();
  el.querySelector('.unavailable')?.remove();
  el.removeAttribute('aria-busy');
}

function flash(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
  el.addEventListener('animationend', () => el.classList.remove('flash'), { once: true });
}

/**
 * Write a live number into `el`.
 * First value counts up from zero; later changes tween from the shown value and flash.
 * Reduced motion: the final text is written immediately, no tween and no flash.
 */
export function setNumber(el, target, fmt) {
  const s = state.get(el) || { shown: null, target: null, raf: 0 };
  state.set(el, s);
  settle(el);
  if (s.target === target) return;
  cancelAnimationFrame(s.raf);
  const first = s.shown === null;
  const from = first ? 0 : s.shown;
  s.target = target;
  el.dataset.value = String(target);

  if (isReduced()) {
    s.shown = target;
    el.textContent = fmt(target);
    return;
  }
  if (!first) flash(el);
  const dur = first ? 1100 : 650;
  let t0 = null;
  const step = (now) => {
    if (t0 === null) t0 = now;
    const p = Math.min((now - t0) / dur, 1);
    const v = from + (target - from) * easeOutCubic(p);
    s.shown = v;
    el.textContent = fmt(p >= 1 ? target : v);
    if (p < 1) s.raf = requestAnimationFrame(step);
    else s.shown = target;
  };
  el.textContent = fmt(from);
  s.raf = requestAnimationFrame(step);
}

/** Replace a pending skeleton with a plain "unavailable" note. A previously shown value is kept. */
export function setUnavailable(el) {
  const s = state.get(el);
  if (s && s.target !== null) return;
  el.querySelector('.skeleton')?.remove();
  el.removeAttribute('aria-busy');
  if (!el.querySelector('.unavailable')) {
    const n = document.createElement('span');
    n.className = 'unavailable';
    n.textContent = 'Unavailable';
    el.appendChild(n);
  }
}

export const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
export const fmtGwei = (v) => (v < 1 ? v.toFixed(4) : v.toFixed(2));
export function fmtUsd(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + v.toFixed(0);
}
