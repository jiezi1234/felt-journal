const motion = require('../core/sticker-motion');
const modal = require('./modal-presentation');
const cardTurn = require('./card-turn');
const OPEN_MS = 420, CLOSE_MS = 260, PAPER_MS = 160;
function live(host) { return host.pickup && !host.pickup.dead && !host.dead; }
function clear(state) { clearTimeout(state.timer); clearTimeout(state.guard); state.sequence++; }
function later(host, fn, ms, key = 'timer') {
  const state = host.pickup, sequence = state.sequence;
  clearTimeout(state[key]); state[key] = setTimeout(() => { if (live(host) && state.sequence === sequence) fn(); }, ms);
}
function mount(host) {
  const source = host.data.source;
  const enabled = !!(source && motion.validRect(source.rect) && typeof wx !== 'undefined' && wx.createAnimation);
  host.pickup = { enabled, phase:enabled ? 'preparing' : 'plain', sequence:0 };
  host.setData({ pickupEnabled:enabled, pickupPhase:enabled ? 'preparing' : '', pickupBusy:enabled });
  if (enabled) later(host, () => fallback(host), 1800, 'guard');
}
function animation() { return wx.createAnimation({ transformOrigin:'50% 50% 0', timingFunction:'ease-out', duration:0 }); }
function pose(anim, values, duration, opacity = 1, delay = 0) {
  return anim.translate(values.x, values.y).rotate(values.angle || 0).scale(values.scale).opacity(opacity).step({ duration, delay, timingFunction:'ease-out' });
}
const identity = { x:0, y:0, scale:1, angle:0 };
function measure(host, done) {
  host.createSelectorQuery().select('.memory-card-overlay').boundingClientRect()
    .select('#pickup-paper').boundingClientRect().select('#card-photo').boundingClientRect().exec(([overlay, paper, photo]) => {
      if (!live(host)) return;
      const target = motion.imageRect(photo, host.pickup.image || host.data.memory || {});
      done(motion.validRect(overlay) && motion.validRect(paper) && target ? { overlay, paper, target } : null);
    });
}
function paperPose(source, paper) {
  const pose = motion.pickupTransform(source, paper);
  return { ...pose, scale:Math.max(.18, Math.min(.55, pose.scale)) };
}
function setup(host, bounds, source) {
  const state = host.pickup;
  state.bounds = bounds; state.source = source;
  state.from = motion.pickupTransform(source, bounds.target); state.paperFrom = paperPose(source, bounds.paper);
  state.photoAnimation = animation(); state.paperAnimation = animation();
  const r = bounds.target, o = bounds.overlay;
  return `left:${r.left-o.left}px;top:${r.top-o.top}px;width:${r.width}px;height:${r.height}px;`;
}
function ready(host) { if (live(host)) { host.pickup.ready = true; prepare(host); } }
function imageLoaded(host, event, flight) {
  if (!live(host)) return;
  const state = host.pickup;
  if (flight) state.flightReady = true;
  else { state.photoReady = true; state.image = { width:event.detail.width, height:event.detail.height }; }
  prepare(host);
}
function prepare(host) {
  const state = host.pickup;
  if (!state.enabled || state.phase !== 'preparing' || !state.ready || !state.photoReady || !state.flightReady) return;
  if (host.data.editing || host.data.missing || !host.data.memory) { fallback(host); return; }
  state.phase = 'measuring';
  measure(host, bounds => {
    if (state.phase !== 'measuring') return;
    if (!bounds) { fallback(host); return; }
    const style = setup(host, bounds, host.data.source.rect);
    state.phase = 'waiting'; state.liftRequested = true;
    host.setData({ pickupPhase:'waiting', pickupFlightStyle:style,
      pickupPhotoAnimation:pose(state.photoAnimation,state.from,0).export(),
      pickupPaperAnimation:pose(state.paperAnimation,state.paperFrom,0,0).export()
    }, () => { if (live(host) && state.phase === 'waiting') host.triggerEvent('pickuplift', { id:host.data.memoryId }); });
  });
}
function begin(host, ok) {
  if (!live(host) || host.pickup.phase !== 'waiting') return;
  if (!ok) { fallback(host); return; }
  const state = host.pickup; clear(state); state.phase = 'opening';
  const raised = { ...state.from, y:state.from.y-9, scale:state.from.scale*1.04 };
  pose(state.photoAnimation, raised, 90); pose(state.photoAnimation, identity, OPEN_MS-90);
  // An unchanged timed step can stall native animation queues. Delay the
  // actual paper transform instead of inserting a no-op pause.
  pose(state.paperAnimation, identity, OPEN_MS-60, 1, 60);
  host.setData({ pickupPhase:'opening', pickupPhotoAnimation:state.photoAnimation.export(), pickupPaperAnimation:state.paperAnimation.export() }, () => {
    later(host, () => { state.phase = 'open'; host.setData({ pickupPhase:'open', pickupBusy:false }); }, OPEN_MS+40);
  });
}
function fallback(host) {
  if (!live(host)) return;
  const state = host.pickup; clear(state); state.enabled = false; state.phase = 'plain';
  if (state.liftRequested) host.triggerEvent('pickuprestore', { id:host.data.memoryId });
  const paper = state.paperAnimation ? pose(animation(),identity,0).export() : {};
  host.setData({ pickupEnabled:false, pickupPhase:'', pickupBusy:false, pickupPaperAnimation:paper, pickupPhotoAnimation:{} });
  modal.thaw(host);
}
function finish(host) {
  if (!live(host) || host.pickup.finished) return;
  const state = host.pickup; clear(state); state.finished = true; state.phase = 'landed';
  host.setData({ pickupPhase:'landed' }); state.done();
}
function close(host, done) {
  const state = host.pickup;
  if (!state || !state.enabled) { modal.close(host, done); return; }
  if (state.closing) return;
  if (state.phase !== 'open' || !host.data.memory || host.data.missing) { fallback(host); modal.close(host, done); return; }
  clear(state); state.closing = true; state.done = done;
  cardTurn.cancel(host); modal.freeze(host);
  state.phase = 'return-request';
  // Closing never waits for a full flip. Measure the hidden front while the
  // current face remains visible, and request the board destination in parallel.
  host.setData({ pickupBusy:true, pickupPhase:'closing', flipBusy:false, turning:false, noteFocus:false }, () => {
    if (!live(host) || state.phase !== 'return-request') return;
    measure(host, bounds => {
      if (state.phase !== 'return-request') return;
      if (!bounds) { fallback(host); modal.close(host, done); return; }
      state.closeBounds = bounds; returnTo(host, state.returnSource);
    });
  });
  if (host.data.modalKeyboard && typeof wx.hideKeyboard === 'function') wx.hideKeyboard({});
  later(host, () => { fallback(host); modal.close(host, done); }, 1200, 'guard');
  host.triggerEvent('pickupreturn', { id:host.data.memoryId });
}
function returnTo(host, source, started) {
  if (!live(host) || host.pickup.phase !== 'return-request') return;
  const state = host.pickup;
  if (source === undefined) return;
  if (!motion.validRect(source)) { fallback(host); modal.close(host, state.done); return; }
  state.returnSource = source;
  if (started) state.returnStarted = started;
  const bounds = state.closeBounds;
  if (bounds) {
    clear(state); const style = setup(host, bounds, source); state.phase = 'returning';
    host.setData({ pickupPhase:'returning', pickupFlightStyle:style,
      pickupPhotoAnimation:pose(state.photoAnimation,identity,0,host.data.flipped ? 0 : 1).export(), pickupPaperAnimation:pose(state.paperAnimation,identity,0).export()
    }, () => {
      if (!live(host) || state.phase !== 'returning') return;
      pose(state.photoAnimation,state.from,CLOSE_MS); pose(state.paperAnimation,{ ...identity, scale:.88, y:8 },PAPER_MS,0);
      host.setData({ pickupPhotoAnimation:state.photoAnimation.export(), pickupPaperAnimation:state.paperAnimation.export() }, () => {
        if (!live(host) || state.phase !== 'returning') return;
        later(host, () => finish(host), CLOSE_MS+20);
        if (state.returnStarted) { const started = state.returnStarted; state.returnStarted = null; started(); }
      });
    });
  }
}
function interrupted(host) {
  if (!live(host) || !host.pickup.enabled || host.pickup.phase === 'open') return;
  const state = host.pickup, done = state.done;
  fallback(host); if (done) modal.close(host, done);
}
function dispose(host) { if (host.pickup) { clear(host.pickup); host.pickup.dead = true; } }
module.exports = { mount, ready, imageLoaded, begin, returnTo, close, fallback, interrupted, dispose, OPEN_MS, CLOSE_MS, PAPER_MS };
