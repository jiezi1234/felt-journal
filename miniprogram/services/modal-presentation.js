const EXIT_MS = 180;
function viewportHeight(base, reported, keyboard) {
  return Math.max(0, Math.min(base - Math.max(0, keyboard || 0), reported || base));
}
function windowInfo() {
  if (typeof wx === 'undefined') return null;
  try { return wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(); } catch (_) { return null; }
}
function update(host) {
  const state = host.modalPresentation; if (!state || !state.alive || state.frozen) return;
  const info = windowInfo(); if (!info) return;
  const reported = info.windowHeight;
  if (!state.keyboard) state.base = reported;
  const safeBottom = info.safeArea ? Math.max(0, (info.screenHeight || reported) - info.safeArea.bottom) : 0;
  host.setData({ modalHeight: viewportHeight(state.base, reported, state.keyboard), modalKeyboard: state.keyboard > 0,
    modalBottom: state.keyboard ? 10 : Math.max(12, safeBottom + 10) });
}
function mount(host) {
  const info = windowInfo();
  const state = host.modalPresentation = { alive: true, base: info ? info.windowHeight : 0, keyboard: 0, width: info && info.windowWidth };
  state.keyboardChanged = event => { state.keyboard = Math.max(0, event.height || 0); update(host); };
  state.resized = event => {
    if (!state.alive) return;
    const size = event.size || {};
    if (size.windowWidth && size.windowWidth !== state.width) {
      state.width = size.windowWidth; state.base = size.windowHeight; state.keyboard = 0;
    }
    update(host);
  };
  if (typeof wx !== 'undefined') {
    if (wx.onKeyboardHeightChange) wx.onKeyboardHeightChange(state.keyboardChanged);
    if (wx.onWindowResize) wx.onWindowResize(state.resized);
  }
  update(host);
}
function close(host, done) {
  const state = host.modalPresentation;
  if (!state) { done(); return; }
  if (!state.alive || state.closing) return;
  state.closing = true; host.setData({ modalClosing: true });
  state.timer = setTimeout(() => { if (state.alive) done(); }, EXIT_MS);
}
// Preserve the measured exit geometry while dismissing a native keyboard.
function freeze(host) { if (host.modalPresentation) host.modalPresentation.frozen = true; }
function thaw(host) { if (host.modalPresentation) { host.modalPresentation.frozen = false; update(host); } }
function dispose(host) {
  const state = host.modalPresentation; if (!state) return;
  state.alive = false; clearTimeout(state.timer);
  if (typeof wx !== 'undefined') {
    if (wx.offKeyboardHeightChange) wx.offKeyboardHeightChange(state.keyboardChanged);
    if (wx.offWindowResize) wx.offWindowResize(state.resized);
  }
}
module.exports = { mount, close, freeze, thaw, dispose, viewportHeight, EXIT_MS };
