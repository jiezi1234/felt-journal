// Keep a decoded raster on screen until its replacement is ready. In
// particular, never clear an <image> src that is currently covering the canvas.
function state(host) { return host.boardSnapshot || (host.boardSnapshot = { release:0 }); }
function settle(host, done) {
  const next = () => {
    if (host.dead) return;
    const canvas = host.canvas, frame = canvas && canvas.requestAnimationFrame;
    if (!host.data.canvasHidden && frame) frame.call(canvas, () => {
      if (!host.dead && host.canvas === canvas) frame.call(canvas, done);
    });
    else setTimeout(done, 34);
  };
  if (typeof wx !== 'undefined' && wx.nextTick) wx.nextTick(next); else next();
}
function finish(host, ok) {
  const s = state(host), pending = s.pending;
  if (!pending) return;
  s.pending = null; clearTimeout(pending.timer); pending.resolve(ok);
}
function cover(host) {
  const s = state(host), release = ++s.release;
  if (!host.data.covered) {
    // The decoded raster stays above the canvas during its first live paint.
    if (host.data.canvasHidden) host.setData({ canvasHidden:false });
    return;
  }
  if (!host.data.snapshot) return;
  host.setData({ snapshotVisible:true }, () => settle(host, () => {
    if (!host.dead && host.data.covered && s.release === release) host.setData({ canvasHidden:true });
  }));
}
function painted(host, version) {
  if (host.data.covered || !host.data.snapshotVisible) return;
  const s = state(host), release = ++s.release;
  settle(host, () => {
    if (!host.dead && !host.data.covered && s.release === release && host.version === version) host.setData({ snapshotVisible:false });
  });
}
function stage(host, path, valid) {
  const s = state(host); finish(host, false);
  if (host.dead || !valid()) return Promise.resolve(false);
  const slot = host.data.snapshotSlot === 'a' ? 'b' : 'a';
  return new Promise(resolve => {
    s.pending = { path, slot, valid, resolve, timer:setTimeout(() => finish(host, false), 800) };
    host.setData({ [slot === 'a' ? 'snapshotA' : 'snapshotB']:path });
  });
}
function loaded(host, event) {
  const s = state(host), p = s.pending, data = event.currentTarget.dataset;
  if (!p || data.path !== p.path || data.slot !== p.slot || host.dead) return;
  if (!p.valid()) { finish(host, false); return; }
  // Both buffers stay mounted. Switch their opacity only after bindload.
  host.setData({ snapshot:p.path, snapshotSlot:p.slot, snapshotVisible:!!host.data.covered || !!host.data.snapshotVisible }, () => {
    if (s.pending !== p) return;
    cover(host);
    finish(host, true);
  });
}
function failed(host, event) {
  const p = state(host).pending, data = event.currentTarget.dataset;
  if (p && p.path === data.path && p.slot === data.slot) finish(host, false);
}
function dispose(host) { const s = state(host); s.release++; finish(host, false); }
module.exports = { stage, loaded, failed, cover, painted, dispose };
