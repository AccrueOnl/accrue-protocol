export const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const isReduced = () => reducedQuery.matches;
export const isDesktop = () => window.innerWidth >= 1024;

const easeInOutCubic = (e) => (e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2);

/** Split an element's text into per-letter units, grouped by word so lines never break mid-word. */
export function splitLetters(el, start, step = 16) {
  el.setAttribute('aria-label', el.textContent);
  const frag = document.createDocumentFragment();
  let n = 0;
  const walk = (node, accent) => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        child.textContent.split(/(\s+)/).forEach((chunk) => {
          if (!chunk) return;
          if (/^\s+$/.test(chunk)) {
            frag.appendChild(document.createTextNode(' '));
            return;
          }
          const wrap = document.createElement('span');
          wrap.className = 'word-wrap';
          wrap.setAttribute('aria-hidden', 'true');
          [...chunk].forEach((ch) => {
            const u = document.createElement('span');
            u.className = 'unit' + (accent ? ' accent' : '');
            u.textContent = ch;
            u.style.transitionDelay = start + n * step + 'ms';
            n++;
            wrap.appendChild(u);
          });
          frag.appendChild(wrap);
        });
      } else if (child.nodeType === 1) {
        walk(child, child.classList.contains('accent'));
      }
    });
  };
  walk(el, false);
  el.textContent = '';
  el.appendChild(frag);
}

export function splitWords(el, start, stagger) {
  const text = el.textContent.trim();
  el.setAttribute('aria-label', text);
  el.textContent = '';
  text.split(/\s+/).forEach((w, i) => {
    const u = document.createElement('span');
    u.className = 'unit word';
    u.setAttribute('aria-hidden', 'true');
    u.textContent = w;
    u.style.transitionDelay = start + i * stagger + 'ms';
    el.appendChild(u);
  });
}

function showHero() {
  document.querySelectorAll('#site .anim').forEach((e) => {
    e.style.transitionDelay = (e.dataset.delay ? parseInt(e.dataset.delay, 10) : 0) + 'ms';
    e.classList.add('in');
  });
  document.querySelectorAll('#site .unit').forEach((e) => e.classList.add('in'));
  // Delays are for the entrance only; clear them so hover transitions respond instantly.
  setTimeout(() => {
    document.querySelectorAll('#site .anim, #site .unit').forEach((e) => (e.style.transitionDelay = ''));
  }, 2600);
}

/** Curtain preloader: rises with a counter, then collapses to reveal the panel. */
function preload(done, alive) {
  const root = document.getElementById('preloader');
  const fill = document.getElementById('fill');
  const counter = document.getElementById('counter');
  if (!root || !fill || !counter) return done();
  let t0 = null;
  let phase = 'load';
  let tCollapse = 0;
  const LOAD = 2000;
  const COLLAPSE = 800;
  const frame = (now) => {
    if (!alive()) return;
    if (t0 === null) t0 = now;
    if (phase === 'load') {
      const p = Math.min((now - t0) / LOAD, 1);
      const e = easeInOutCubic(p);
      fill.style.bottom = '0';
      fill.style.top = 'auto';
      fill.style.height = e * 100 + '%';
      counter.textContent = Math.round(e * 100) + '%';
      const r = Math.min(e, 0.9);
      counter.style.bottom = `calc(${r} * (100dvh - 1.25rem - 4rem) + 0.625rem)`;
      counter.style.opacity = e <= 0.9 ? 1 : 1 - (e - 0.9) / 0.1;
      if (p >= 1) {
        phase = 'collapse';
        tCollapse = now;
      }
    } else {
      const p = Math.min((now - tCollapse) / COLLAPSE, 1);
      const e = easeInOutCubic(p);
      fill.style.top = '0';
      fill.style.bottom = 'auto';
      fill.style.height = (1 - e) * 100 + '%';
      counter.style.opacity = 0;
      if (p >= 1) {
        root.remove();
        done();
        return;
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function reveals() {
  const els = [...document.querySelectorAll('#site .reveal')];
  if (isReduced() || !('IntersectionObserver' in window)) {
    els.forEach((e) => e.classList.add('in'));
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('in');
        io.unobserve(en.target);
        setTimeout(() => (en.target.style.transitionDelay = ''), 1400);
      });
    },
    { threshold: 0.12 }
  );
  els.forEach((e) => {
    const sibs = [...e.parentElement.querySelectorAll(':scope > .reveal')];
    e.style.transitionDelay = Math.max(0, sibs.indexOf(e)) * 80 + 'ms';
    io.observe(e);
  });
  return () => io.disconnect();
}

function progress() {
  const bar = document.getElementById('progress-bar');
  if (!bar) return () => {};
  let queued = false;
  const update = () => {
    queued = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${p})`;
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
}

function parallax() {
  const els = [...document.querySelectorAll('[data-parallax]')];
  if (!els.length || isReduced()) return () => {};
  let queued = false;
  const update = () => {
    queued = false;
    const vh = window.innerHeight;
    els.forEach((el) => {
      const r = el.parentElement.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) return;
      const k = parseFloat(el.dataset.parallax);
      el.style.setProperty('--py', ((r.top + r.height / 2 - vh / 2) * k).toFixed(2));
    });
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  update();
  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
}

function anchors() {
  const onClick = (ev) => {
    const a = ev.target.closest('a[href^="#"]');
    if (!a) return;
    ev.preventDefault();
    const id = a.getAttribute('href').slice(1);
    const target = id && id !== 'home' ? document.getElementById(id) : null;
    const behavior = isReduced() ? 'auto' : 'smooth';
    if (target) target.scrollIntoView({ behavior });
    else window.scrollTo({ top: 0, behavior });
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}

export function initMotion() {
  let alive = true;
  document.querySelectorAll('#site [data-letters]').forEach((e) => splitLetters(e, parseInt(e.dataset.start, 10)));
  document.querySelectorAll('#site .words').forEach((e) => splitWords(e, parseInt(e.dataset.start, 10), parseInt(e.dataset.stagger, 10)));
  const cleanups = [reveals(), progress(), parallax(), anchors()];
  if (isReduced() || !isDesktop()) {
    document.getElementById('preloader')?.remove();
    showHero();
  } else {
    preload(showHero, () => alive);
  }
  return () => {
    alive = false;
    cleanups.forEach((c) => c());
  };
}
