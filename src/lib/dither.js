import { isReduced, reducedQuery } from './motion.js';

const BAYER = (() => {
  let cur = [[0, 2], [3, 1]];
  while (cur.length < 8) {
    const n = cur.length;
    const next = Array.from({ length: n * 2 }, () => new Array(n * 2));
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = cur[y][x] * 4;
        next[y][x] = v;
        next[y][x + n] = v + 2;
        next[y + n][x] = v + 3;
        next[y + n][x + n] = v + 1;
      }
    }
    cur = next;
  }
  return cur.flat().map((v) => (v + 0.5) / 64);
})();

/** Resolve any CSS colour (including oklch) to [r,g,b] via a 1px canvas. */
function rgbOf(ctx, css) {
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

/** Ordered-dither flow field. Pointer adds a soft bright wake. Pauses off-screen and when reduced. */
export function initDither(canvas) {
  if (!canvas) return () => {};
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return () => {};
  const css = getComputedStyle(document.documentElement);
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const lo = rgbOf(probe, css.getPropertyValue('--dither-lo').trim());
  const hi = rgbOf(probe, css.getPropertyValue('--dither-hi').trim());

  const CELL = 6;
  let w = 0;
  let h = 0;
  let img = null;
  const pointer = { x: -1, y: -1, tx: -1, ty: -1, on: 0 };
  let visible = true;
  let raf = 0;
  let t = 0;
  let last = 0;

  const paint = () => {
    if (!img) return;
    const data = img.data;
    const px = pointer.x * w;
    const py = pointer.y * h;
    const rad = Math.max(w, h) * 0.16;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const nx = x / w;
        const ny = y / h;
        let v = 0.3 + 0.17 * Math.sin(nx * 6 + t * 0.6) + 0.13 * Math.sin(ny * 7 - t * 0.45 + Math.sin(nx * 4 + t * 0.3) * 2.2);
        v *= 0.25 + 0.75 * (1 - ny) * (1 - ny);
        if (pointer.on > 0.01) {
          const dx = x - px;
          const dy = y - py;
          v += pointer.on * 0.55 * Math.exp(-(dx * dx + dy * dy) / (rad * rad));
        }
        const c = v > BAYER[(y & 7) * 8 + (x & 7)] ? hi : lo;
        const i = (y * w + x) * 4;
        data[i] = c[0];
        data[i + 1] = c[1];
        data[i + 2] = c[2];
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  };

  const resize = () => {
    const r = canvas.getBoundingClientRect();
    w = Math.max(8, Math.ceil(r.width / CELL));
    h = Math.max(8, Math.ceil(r.height / CELL));
    canvas.width = w;
    canvas.height = h;
    img = ctx.createImageData(w, h);
    paint();
  };

  const loop = (now) => {
    raf = 0;
    if (!visible || document.hidden || isReduced()) return;
    const dt = Math.min(64, now - (last || now));
    last = now;
    t += dt / 1000;
    pointer.x += (pointer.tx - pointer.x) * 0.12;
    pointer.y += (pointer.ty - pointer.y) * 0.12;
    pointer.on += ((pointer.tx >= 0 ? 1 : 0) - pointer.on) * 0.08;
    paint();
    raf = requestAnimationFrame(loop);
  };
  const kick = () => {
    if (!raf && visible && !document.hidden && !isReduced()) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
  };

  const host = canvas.closest('.panel') || canvas.parentElement;
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.tx = (e.clientX - r.left) / r.width;
    pointer.ty = (e.clientY - r.top) / r.height;
    if (pointer.x < 0) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
    }
  };
  const onLeave = () => {
    pointer.tx = -1;
    pointer.ty = -1;
  };
  host.addEventListener('pointermove', onMove);
  host.addEventListener('pointerleave', onLeave);

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { visible = es[0].isIntersecting; kick(); }, { threshold: 0.01 }) : null;
  io?.observe(canvas);
  let rt = 0;
  const onResize = () => { clearTimeout(rt); rt = setTimeout(resize, 120); };
  window.addEventListener('resize', onResize);
  const onVis = () => kick();
  document.addEventListener('visibilitychange', onVis);
  const onMotion = () => { paint(); kick(); };
  reducedQuery.addEventListener('change', onMotion);

  resize();
  kick();
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(rt);
    io?.disconnect();
    host.removeEventListener('pointermove', onMove);
    host.removeEventListener('pointerleave', onLeave);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVis);
    reducedQuery.removeEventListener('change', onMotion);
  };
}
