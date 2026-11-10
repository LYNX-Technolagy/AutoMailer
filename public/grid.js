// Cursor-distorted grid. Renders a full-viewport grid on a canvas and
// pushes nearby line segments away from the pointer.
(() => {
  const canvas = document.getElementById('grid-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const SPACING = 40;          // px between grid lines
  const RADIUS = 160;          // influence radius of the cursor
  const STRENGTH = 26;         // max px a point is displaced
  const POINT_STEP = 12;       // sample points along each line (lower = smoother, slower)

  let dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = 0;
  let height = 0;

  const pointer = { x: -9999, y: -9999, active: false };
  let rafId = null;
  let needsDraw = true;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    needsDraw = true;
    scheduleDraw();
  }

  // Displace a point by the cursor, pushing it away.
  function displace(x, y) {
    if (!pointer.active) return [x, y];
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    const dist = Math.hypot(dx, dy);
    if (dist > RADIUS || dist === 0) return [x, y];
    const force = (1 - dist / RADIUS) * STRENGTH;
    const nx = dx / dist;
    const ny = dy / dist;
    return [x + nx * force, y + ny * force];
  }

  function drawLine(vertical, fixed, from, to) {
    ctx.beginPath();
    const steps = Math.max(2, Math.ceil((to - from) / POINT_STEP));
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps;
      const [px, py] = vertical ? displace(fixed, t) : displace(t, fixed);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  function draw() {
    rafId = null;
    ctx.clearRect(0, 0, width, height);

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(237, 237, 237, 0.045)';

    // Vertical lines
    for (let x = 0; x <= width + SPACING; x += SPACING) {
      drawLine(true, x, 0, height);
    }
    // Horizontal lines
    for (let y = 0; y <= height + SPACING; y += SPACING) {
      drawLine(false, y, 0, width);
    }

    // Optional: tiny dot at cursor to reinforce the "push" feeling is off —
    // the effect reads better without it. Leave commented.
    // ctx.fillStyle = 'rgba(237,237,237,0.4)';
    // ctx.beginPath(); ctx.arc(pointer.x, pointer.y, 2, 0, Math.PI * 2); ctx.fill();
  }

  function scheduleDraw() {
    if (rafId != null) return;
    rafId = requestAnimationFrame(draw);
  }

  function onPointerMove(e) {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    pointer.active = true;
    if (!reducedMotion) scheduleDraw();
  }

  function onPointerLeave() {
    pointer.active = false;
    scheduleDraw();
  }

  window.addEventListener('resize', resize);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerleave', onPointerLeave);

  // Pause rendering when tab hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    } else {
      scheduleDraw();
    }
  });

  resize();

  // If reduced motion, draw once and stop listening.
  if (reducedMotion) {
    pointer.active = false;
    draw();
    window.removeEventListener('pointermove', onPointerMove);
  }
})();