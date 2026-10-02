import { register } from '@register';
import { isStated, isAddress, handleOf, linkOf } from '../facts.js';

const ICONS = {
  x: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-6.5L6.3 22H3.2l7.3-8.3L2.4 2h6.4l4.4 5.9L18.9 2Zm-1.1 18h1.7L8.3 3.8H6.5L17.8 20Z"/></svg>',
  github:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.3 2.8.1 3.2.8.8 1.3 1.9 1.3 3.1 0 4.6-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3"/></svg>',
};

function toast(message) {
  document.querySelectorAll('.site-toast').forEach((e) => e.remove());
  const t = document.createElement('div');
  t.className = 'site-toast';
  t.setAttribute('role', 'status');
  t.innerHTML = '<span class="t-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></span>';
  t.appendChild(document.createTextNode(message));
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('leaving'), 2200);
  setTimeout(() => t.remove(), 2600);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Contract slot: always present, full address when stated, inert otherwise. No dates ever. */
function renderCA() {
  const slot = document.getElementById('ca-slot');
  const btn = document.getElementById('ca-btn');
  const val = document.getElementById('ca-val');
  if (!slot || !btn || !val) return;
  const rec = register.ca;
  const live = isStated(rec) && isAddress(rec.value);
  if (isStated(rec) && !live) console.warn('register.ca is stated but is not a 0x + 40 hex address; rendering inert.');
  slot.dataset.state = live ? 'stated' : rec.state === 'unconfirmed' ? 'unconfirmed' : 'absent';
  if (!live) {
    val.textContent = rec.state === 'unconfirmed' ? 'Awaiting confirmation' : 'Not announced yet';
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    btn.setAttribute('aria-label', 'Contract address: ' + val.textContent);
    return;
  }
  val.textContent = rec.value;
  btn.disabled = false;
  btn.removeAttribute('aria-disabled');
  btn.setAttribute('aria-label', 'Copy contract address ' + rec.value);
  btn.title = 'Copy contract address';
  btn.addEventListener('click', async () => {
    if (await copyText(rec.value)) toast('Contract address copied');
  });
}

/** Icon-only socials, top right. Handle is derived from the stored URL. No href unless stated. */
function renderSocials() {
  document.querySelectorAll('.social-slot').forEach((slot) => {
    const rec = register[slot.dataset.key];
    if (!rec) return;
    const href = linkOf(rec);
    slot.textContent = '';
    if (href) {
      const a = document.createElement('a');
      a.className = 'social-btn';
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('aria-label', `${rec.label}: ${handleOf(href) || href}`);
      a.innerHTML = ICONS[slot.dataset.key];
      slot.appendChild(a);
    } else {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'social-btn';
      b.disabled = true;
      b.setAttribute('aria-disabled', 'true');
      b.setAttribute('aria-label', `${rec.label}: not announced yet`);
      b.innerHTML = ICONS[slot.dataset.key];
      slot.appendChild(b);
    }
  });
}

function renderSources() {
  const col = document.getElementById('source-col');
  if (!col) return;
  [register.llamaUrl, register.dexUrl].forEach((rec) => {
    const href = linkOf(rec);
    if (!href) return;
    const a = document.createElement('a');
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = rec.label;
    col.appendChild(a);
  });
}

function renderFacts() {
  document.querySelectorAll('[data-reg]').forEach((el) => {
    const rec = register[el.dataset.reg];
    if (isStated(rec)) el.textContent = String(rec.value);
  });
}

export function initSlots() {
  renderCA();
  renderSocials();
  renderSources();
  renderFacts();
}
