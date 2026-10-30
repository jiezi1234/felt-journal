const snapshots = require('./board-snapshot');
function state(host) { return host.recallBackdrop || (host.recallBackdrop = { epoch: 0 }); }
function key(host) { return host.canvas && JSON.stringify([host.data.model, host.canvas.width, host.canvas.height]); }
function allowed(host) {
  return !host.dead && !host.pageHidden && host.canvas && host.data.model && !host.data.covered && !host.data.occluded &&
    !host.data.freezeCanvas && !host.data.editable && !host.data.selected && !host.data.landingId && !host.gesture && !host.dragModel &&
    host.data.floatingControls && host.data.floatingControls.recall;
}
function cancel(host) { const s = state(host); clearTimeout(s.timer); s.timer = null; s.pending = ''; s.epoch++; }
function ready(host) {
  const s = state(host);
  return !!(s.path && s.path === host.data.snapshot && s.key === key(host) && !host.data.editable && !host.data.selected && !host.dead);
}
function warm(host) {
  if (!allowed(host)) { cancel(host); return; }
  const s = state(host), current = key(host);
  if (ready(host) || s.pending === current) return;
  cancel(host); const epoch = s.epoch; s.pending = current;
  // Capture the settled frame once, outside the press and sheet animations.
  s.timer = setTimeout(() => {
    s.timer = null;
    const valid = () => s.epoch === epoch && allowed(host) && key(host) === current;
    const finish = () => { if (s.epoch === epoch) s.pending = ''; };
    if (!valid() || host.boardSnapshot && host.boardSnapshot.pending) { finish(); return; }
    try {
      wx.canvasToTempFilePath({ canvas: host.canvas, fileType: 'png',
        success: result => {
          if (!valid()) { finish(); return; }
          snapshots.stage(host, result.tempFilePath, valid).then(ok => {
            if (ok && valid()) { s.key = current; s.path = result.tempFilePath; }
            finish();
          });
        }, fail: finish
      });
    } catch (_) { finish(); }
  }, 120);
}
module.exports = { warm, ready, cancel };
