// Only the brief turn uses a 2D fold. Resting faces (especially native text
// inputs) must not remain in nested rotateY/preserve-3d compositing layers.
const HALF_MS = 200, SETTLE_MS = 30;
function cancel(host) {
  clearTimeout(host.cardTurnTimer);
  host.cardTurnToken = (host.cardTurnToken || 0) + 1;
}
function turn(host, back, done) {
  const wasTurning = host.data.flipBusy;
  cancel(host);
  if (!wasTurning && host.data.flipped === back) { if (done) done(); return; }
  const token = host.cardTurnToken;
  const live = () => !host.dead && token === host.cardTurnToken;
  host.lastFlipAt = Date.now();
  host.setData({ flipBusy:true, turning:true, noteFocus:false }, () => {
    if (!live()) return;
    host.cardTurnTimer = setTimeout(() => {
      if (!live()) return;
      host.setData({ flipped:back, turning:false }, () => {
        if (!live()) return;
        host.cardTurnTimer = setTimeout(() => {
          if (!live()) return;
          host.setData({ flipBusy:false }); if (done) done();
        }, HALF_MS + SETTLE_MS);
      });
    }, HALF_MS + SETTLE_MS);
  });
}
module.exports = { turn, cancel, HALF_MS, SETTLE_MS };
