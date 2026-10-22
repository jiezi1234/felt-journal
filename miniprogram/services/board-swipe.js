const renderer = require('../core/renderer');
const viewport = require('../core/board-viewport');
const B = require('../core/config').board;

// Keep only the two neighbouring boards. During movement, each frame consists
// of two bitmap blits; felt fibres, pins and photographs are not repainted.
function bitmap(host, model, images, surface) {
  const canvas = wx.createOffscreenCanvas({ type: '2d', width: host.canvas.width, height: host.canvas.height });
  const shown = viewport.present(model, host.screenWidth, host.data.height), bounds = renderer.frame(shown.dimensions);
  const ctx = canvas.getContext('2d'), sy = canvas.height / bounds.height;
  ctx.setTransform(canvas.width / B.width, 0, 0, sy, 0, bounds.top * sy);
  renderer.paint(ctx, shown.model, images, '', shown.dimensions, surface, canvas.width / B.width);
  return canvas;
}
function warm(host) {
  if (host.dead || !host.canvas || !host.data.allowSwipe || !host.images || typeof wx === 'undefined' || !wx.createOffscreenCanvas) return;
  const old = host.swipeCache || {}, cache = {};
  for (const [side, model] of [['previous', host.data.swipePrevious], ['next', host.data.swipeNext]]) {
    if (!model) continue;
    const key = JSON.stringify([host.canvas.width, host.canvas.height, model]);
    if (old[side] && old[side].key === key) { cache[side] = old[side]; continue; }
    const entry = cache[side] = { key, model }, canvas = host.canvas;
    entry.ready = renderer.loadImages(canvas, model.items || [], host.images, false).then(images => {
      if (host.dead || canvas !== host.canvas || !host.swipeCache || host.swipeCache[side] !== entry) return;
      entry.frame = bitmap(host, model, images);
    }).catch(() => {});
  }
  host.swipeCache = cache;
}
function stopFrame(host, motion) {
  if (motion.frame == null) return;
  if (motion.nativeFrame) host.canvas.cancelAnimationFrame(motion.frame); else clearTimeout(motion.frame);
  motion.frame = null;
}
function frame(host, motion, callback) {
  if (motion.frame != null) return;
  motion.nativeFrame = !!(host.canvas.requestAnimationFrame && host.canvas.cancelAnimationFrame);
  const run = () => { motion.frame = null; if (!host.dead && host.swipeMotion === motion) callback(); };
  motion.frame = motion.nativeFrame ? host.canvas.requestAnimationFrame(run) : setTimeout(run, 16);
}
function paint(host, motion) {
  const ctx = host.canvas.getContext('2d'), ratio = host.canvas.width / host.screenWidth;
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, host.canvas.width, host.canvas.height);
  ctx.drawImage(motion.source, motion.x * ratio, 0);
  if (motion.entry && motion.entry.frame) ctx.drawImage(motion.entry.frame, (motion.x + motion.direction * motion.span) * ratio, 0);
}
function finish(host) {
  const motion = host.swipeMotion; if (!motion) return;
  stopFrame(host, motion); clearTimeout(motion.timer); host.swipeMotion = null;
  if (!host.dead) { host.setData({ swipeActive: false }); host.triggerEvent('swipestate', { active: false }); }
}
function animate(host, motion, destination, done) {
  stopFrame(host, motion); clearTimeout(motion.timer);
  const from = motion.x, started = Date.now();
  const duration = destination ? Math.max(180, Math.min(320, 160 + Math.abs(destination - from) / motion.span * 160)) : 230;
  motion.phase = 'settling';
  const tick = () => {
    const t = Math.min(1, (Date.now() - started) / duration), ease = 1 - Math.pow(1 - t, 3);
    motion.x = from + (destination - from) * ease; paint(host, motion);
    if (t < 1) frame(host, motion, tick); else done();
  };
  frame(host, motion, tick);
}
function cancel(host, immediate = true) {
  const motion = host.swipeMotion; if (!motion) return;
  if (immediate || host.dead) { finish(host); if (!host.dead) host.refresh(); }
  else animate(host, motion, 0, () => { finish(host); host.refresh(); });
}
function update(host, dx) {
  if (!host.canvas || host.data.canvasHidden || !host.data.model || typeof wx === 'undefined' || !wx.createOffscreenCanvas) return false;
  let motion = host.swipeMotion;
  if (!motion) {
    let source;
    try { source = bitmap(host, host.data.model, host.images, host.surface && host.surface.canvas); } catch (_) { return false; }
    host.version = (host.version || 0) + 1; // Invalidate a pending live paint.
    motion = host.swipeMotion = { source, fromId: host.data.model.id, span: host.screenWidth + 16, x: 0, phase: 'tracking' };
    host.setData({ swipeActive: true, handles: [], actions: [], snapshotVisible: false });
    host.triggerEvent('swipestate', { active: true });
  }
  if (motion.phase !== 'tracking') return true;
  motion.direction = dx < 0 ? 1 : -1;
  motion.entry = host.swipeCache && host.swipeCache[dx < 0 ? 'next' : 'previous'];
  // The first/last board resists instead of exposing a full empty viewport.
  motion.x = motion.entry && motion.entry.frame ? Math.max(-motion.span, Math.min(motion.span, dx)) : dx * .28 / (1 + Math.abs(dx) / host.screenWidth);
  frame(host, motion, () => paint(host, motion));
  return true;
}
function release(host, offset) {
  const motion = host.swipeMotion; if (!motion) return false;
  if (!offset || !motion.entry || offset !== motion.direction) { cancel(host, false); return true; }
  const settle = () => {
    if (host.dead || host.swipeMotion !== motion || motion.phase !== 'waiting') return;
    clearTimeout(motion.timer);
    if (!motion.entry.frame) { cancel(host, false); return; }
    animate(host, motion, -offset * motion.span, () => {
      motion.phase = 'committing';
      // Hold the complete incoming frame until its live canvas is painted.
      motion.timer = setTimeout(() => cancel(host), 900);
      host.triggerEvent('boardswipe', { offset, targetId: motion.entry.model.id });
    });
  };
  motion.phase = 'waiting';
  if (motion.entry.frame) settle();
  else { motion.timer = setTimeout(() => cancel(host, false), 500); motion.entry.ready.then(settle); }
  return true;
}
function hold(host) {
  const motion = host.swipeMotion;
  if (!motion) return false;
  if (motion.phase === 'committing' && host.data.model.id === motion.entry.model.id) return false;
  if (host.data.model.id !== motion.fromId) { finish(host); return false; }
  return true;
}
function beforePaint(host) {
  const motion = host.swipeMotion;
  if (motion && motion.phase === 'committing' && host.data.model.id === motion.entry.model.id) finish(host);
}
function dispose(host) { finish(host); host.swipeCache = null; }
module.exports = { warm, update, release, hold, beforePaint, cancel, dispose };
