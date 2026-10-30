// One shell survives menu navigation; only closing it releases the board.
const modal = require('./modal-presentation');
const EXIT_MS = 220;
const data = { sheetScene: '', sheetClosing: false, sheetLibraryMounted: false, sheetViewportHeight: 0, sheetKeyboard: false, recordClosing: false };
function blocked(host) {
  const library = host.data.sheetScene === 'library' && host.selectComponent && host.selectComponent('#memory-library-card');
  return host.data.sheetClosing || host.data.working || host.data.memoryCardId || library && library.data && library.data.working;
}
function leaveRename(host) {
  modal.dispose(host);
  if (typeof wx !== 'undefined' && wx.hideKeyboard) wx.hideKeyboard({});
}
function root(host) { return host.data.mode === 'themes' ? 'theme' : 'calendar-options'; }
function menu(host) { return { sheetScene: 'menu', sheetClosing: false, sheetLibraryMounted: false, drawer: root(host) }; }
function navigate(host, scene, update = {}) {
  if (!host.data.sheetScene || blocked(host)) return false;
  if (host.dirty && !host.persist()) return false;
  const leavingRename = host.data.sheetScene === 'rename' && scene !== 'rename';
  if (leavingRename) leaveRename(host);
  host.setData({ sheetScene: scene, drawer: scene === 'menu' ? root(host) : scene === 'appearance' ? 'appearance' : '',
    libraryOpen: scene === 'library', ...(scene === 'library' ? { sheetLibraryMounted: true } : {}),
    ...(leavingRename ? { formOpen: false, formError: '', editingId: '', title: '', sheetViewportHeight: 0, sheetKeyboard: false } : {}), ...update });
  if (scene === 'rename') modal.mount(host, viewport => {
    if (host.data.sheetScene === 'rename') host.setData({ sheetViewportHeight: viewport.modalHeight, sheetKeyboard: viewport.modalKeyboard });
  });
  host.syncNavigation(); return true;
}
function close(host, done) {
  if (!host.data.sheetScene || blocked(host)) return;
  if (host.dirty && !host.persist()) return;
  host.setData({ sheetClosing: true });
  const finish = () => {
    host.sheetCloseTimer = null;
    if (host.disposed) return;
    host.setData({ ...data, drawer: '', libraryOpen: false });
    host.refresh(); host.syncNavigation();
    if (done) done();
  };
  if (typeof wx === 'undefined') finish(); else host.sheetCloseTimer = setTimeout(finish, EXIT_MS);
}
function reset(host) {
  clearTimeout(host.sheetCloseTimer); host.sheetCloseTimer = null;
  const renaming = host.data.sheetScene === 'rename';
  if (renaming) leaveRename(host);
  host.setData({ ...data, ...(renaming ? { formOpen: false, formError: '', editingId: '', title: '' } : {}) });
}
module.exports = { data, menu, navigate, close, reset, EXIT_MS };
