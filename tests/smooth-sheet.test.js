const test = require('node:test');
const assert = require('node:assert/strict');
const sheet = require('../miniprogram/services/smooth-sheet');
function host() {
  return { data: { ...sheet.data, mode: 'calendar', ...{ sheetScene: 'menu', drawer: 'calendar-options' } },
    setData(update) { Object.assign(this.data, update); }, refresh() {}, syncNavigation() {}, persist() { return true; } };
}
test('More navigation retains its library instance, returns to its menu and refuses failed saves', () => {
  const p = host(); sheet.navigate(p, 'library'); assert.equal(p.data.libraryOpen, true);
  sheet.navigate(p, 'menu'); assert.equal(p.data.sheetLibraryMounted, true); assert.equal(p.data.libraryOpen, false);
  p.dirty = true; p.persist = () => false;
  assert.equal(sheet.navigate(p, 'appearance'), false); sheet.close(p);
  assert.equal(p.data.sheetScene, 'menu'); assert.equal(p.data.sheetClosing, false);
});
test('exit retains the scrim until completion, ignores duplicate closes and cancels on page hide', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const before = global.wx; global.wx = {}; t.after(() => { global.wx = before; });
  const p = host(); let calls = 0;
  sheet.close(p, () => calls++); sheet.close(p, () => calls++);
  t.mock.timers.tick(219); assert.equal(p.data.sheetScene, 'menu'); assert.equal(calls, 0);
  t.mock.timers.tick(1); assert.equal(p.data.sheetScene, ''); assert.equal(calls, 1);
  Object.assign(p.data, sheet.menu(p)); sheet.close(p, () => calls++); sheet.reset(p);
  Object.assign(p.data, sheet.menu(p)); t.mock.timers.tick(1000);
  assert.equal(p.data.sheetScene, 'menu'); assert.equal(calls, 1);
});
test('detail cards block closing and navigation through the sheet below them', () => {
  const p = host(); p.data.memoryCardId = 'memory';
  assert.equal(sheet.navigate(p, 'appearance'), false); sheet.close(p);
  assert.equal(p.data.sheetScene, 'menu'); assert.equal(p.data.sheetClosing, false);
});
test('a library operation in progress cannot be dismissed through the shared scrim', () => {
  const p = host(); p.data.sheetScene = 'library';
  p.selectComponent = () => ({ data: { working: true } });
  assert.equal(sheet.navigate(p, 'menu'), false); sheet.close(p);
  assert.equal(p.data.sheetScene, 'library'); assert.equal(p.data.sheetClosing, false);
});

test('rename follows keyboard height and releases listeners and late callbacks on return', t => {
  const before = global.wx, listeners = {};
  global.wx = { getWindowInfo: () => ({ windowWidth: 390, windowHeight: 800 }), hideKeyboard() {},
    onKeyboardHeightChange(fn) { listeners.keyboard = fn; }, offKeyboardHeightChange() { delete listeners.keyboard; },
    onWindowResize(fn) { listeners.resize = fn; }, offWindowResize() { delete listeners.resize; } };
  t.after(() => { global.wx = before; });
  const p = host(); p.data.mode = 'themes';
  sheet.navigate(p, 'rename', { formOpen: true, editingId: 'theme', title: '名字' });
  assert.equal(p.data.sheetViewportHeight, 800);
  const late = listeners.keyboard; late({ height: 300 }); assert.equal(p.data.sheetViewportHeight, 500);
  sheet.navigate(p, 'menu'); assert.deepEqual(listeners, {}); assert.equal(p.data.sheetViewportHeight, 0);
  assert.equal(p.data.formOpen, false); late({ height: 300 }); assert.equal(p.data.sheetViewportHeight, 0);
});
