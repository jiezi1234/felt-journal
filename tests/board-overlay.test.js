const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = require('../miniprogram/core/renderer');
let definition;
global.Component = value => { definition = value; };
require('../miniprogram/components/felt-board/index');
delete global.Component;

test('covered boards retain a snapshot but ignore callbacks after reopening or detaching', async t => {
  const originalWx = global.wx, originalRenderer = { ...renderer }, requests = [];
  t.after(() => { global.wx = originalWx; Object.assign(renderer, originalRenderer); });
  global.wx = { canvasToTempFilePath: request => requests.push(request) };
  renderer.loadImages = async () => ({}); renderer.paint = () => {}; renderer.paintControls = () => {};
  const board = Object.assign({}, definition.methods, {
    data: { model: { items: [] }, covered: true, editable: false, snapshot: '', selected: '' },
    canvas: { width: 600, height: 400, getContext: () => ({ setTransform() {} }) }, screenWidth: 300,
    setData(value) { Object.assign(this.data, value); }
  });
  await board.refresh(); assert.equal(requests.length, 1);
  board.data.covered = false; await board.refresh(); requests[0].success({ tempFilePath: '/late.png' });
  assert.equal(board.data.snapshot, '', 'Returning to live editing must ignore a late snapshot');
  board.data.covered = true; await board.refresh(); requests[1].success({ tempFilePath: '/current.png' });
  assert.equal(board.data.snapshot, '/current.png');
  await board.refresh(); board.dead = true; requests[2].success({ tempFilePath: '/detached.png' });
  assert.equal(board.data.snapshot, '/current.png', 'Detached cards must not update their UI');
});

test('covered boards do not respond to pointer input underneath a card', () => {
  const board = Object.assign({}, definition.methods, { data: { covered: true, interactive: true, model: { items: [] } },
    createSelectorQuery() { throw new Error('Background board must not start a gesture'); } });
  board.touchStart({ touches: [{ clientX: 10, clientY: 10 }] }); assert.equal(board.gesture, null);
});

test('a simple editable sticker tap opens its card but dragging and long press do not open it twice', () => {
  const events = [], item = { id: 'placement', memoryId: 'memory' };
  const board = { ...definition.methods, data: { editable: true, interactive: true }, refresh() {}, triggerEvent(name, detail) { events.push({ name, detail }); } };
  board.gesture = { item }; board.touchEnd(); assert.deepEqual(events, [{ name: 'memory', detail: { id: 'memory' } }]);
  events.length = 0; board.gesture = { item, moved: true, next: { ...item, x: 40 } }; board.touchEnd(); assert.deepEqual(events.map(e => e.name), ['change']);
  events.length = 0; board.gesture = { item, long: true }; board.touchEnd(); assert.deepEqual(events, []);
  board.gesture = {}; board.touchEnd(); assert.deepEqual(events, [{ name: 'select', detail: { id: '' } }]);
});

function gestureFixture(t, data = {}, delayed = false) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const B = require('../miniprogram/core/config').board;
  const item = require('../miniprogram/core/geometry').create('memory', 400, 300, 0, 1), events = [];
  const rect = { left: 20, top: 40 }, screenWidth = 360;
  const touch = { clientX: rect.left + (item.x + B.inset) * screenWidth / B.width, clientY: rect.top + (item.y + B.inset) * screenWidth / B.width };
  let callback;
  const board = { ...definition.methods, data: { model: { items: [item] }, interactive: true, canEdit: true, editable: false, selected: '', ...data }, screenWidth,
    refresh() {}, triggerEvent(name, detail) {
      events.push({ name, detail });
      if (name === 'edititem') Object.assign(this.data, { editable: true, selected: detail.id });
    },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect(cb) { callback = cb; return this; }, exec() { if (!delayed) callback(rect); } }; }
  };
  return { board, item, events, start: () => board.touchStart({ touches: [touch] }), measure: () => callback(rect),
    move: dx => board.touchMove({ touches: [{ ...touch, clientX: touch.clientX + dx }] }) };
}

test('tapping an object opens its card without selecting it in browse or edit mode', t => {
  const f = gestureFixture(t);
  for (const editable of [false, true]) {
    f.board.data.editable = editable; f.events.length = 0;
    f.start(); assert.deepEqual(f.events, []); t.mock.timers.tick(300); f.board.touchEnd(); t.mock.timers.tick(1000);
    assert.deepEqual(f.events, [{ name: 'memory', detail: { id: f.item.memoryId } }]);
    assert.equal(f.board.data.selected, '');
  }
});

test('holding an object enters editing once; releasing does not open its card', t => {
  const f = gestureFixture(t); f.start(); t.mock.timers.tick(649); assert.deepEqual(f.events, []);
  t.mock.timers.tick(1); assert.equal(f.board.data.editable, true); assert.equal(f.board.data.selected, f.item.memoryId);
  f.board.touchEnd(); t.mock.timers.tick(1000);
  assert.deepEqual(f.events, [{ name: 'edititem', detail: { id: f.item.memoryId } }]);
});

test('movement cancels long press and cannot move an unselected object', t => {
  const f = gestureFixture(t, { editable: true }); f.start(); f.move(20); t.mock.timers.tick(1000); f.board.touchEnd();
  assert.deepEqual(f.events, []); assert.equal(f.board.dragModel, null);
});

test('dragging works after long press and on a subsequent gesture of the selected object', t => {
  const f = gestureFixture(t); f.start(); t.mock.timers.tick(650); f.move(20); f.board.touchEnd();
  assert.deepEqual(f.events.map(e => e.name), ['edititem', 'change']); assert.ok(f.events[1].detail.placement.x > f.item.x);
  f.events.length = 0; f.start(); f.move(-20); t.mock.timers.tick(1000); f.board.touchEnd();
  assert.deepEqual(f.events.map(e => e.name), ['change']); assert.ok(f.events[0].detail.placement.x < f.item.x);
});

test('cancellation, covering, backgrounding, multitouch and detaching suppress pending long presses', t => {
  const f = gestureFixture(t);
  const cancel = [() => f.board.touchCancel(), () => { f.board.data.covered = true; definition.observers['covered, interactive'].call(f.board); },
    () => definition.pageLifetimes.hide.call(f.board), () => f.board.touchMove({ touches: [{}, {}] }), () => definition.lifetimes.detached.call(f.board)];
  for (const stop of cancel) {
    f.board.dead = false; f.board.data.covered = false; f.start(); stop(); t.mock.timers.tick(1000); f.board.touchEnd(); assert.deepEqual(f.events, []);
  }
});

test('delayed measurements cannot revive canceled or already moving presses', t => {
  const f = gestureFixture(t, {}, true);
  f.start(); f.move(20); f.measure(); t.mock.timers.tick(1000); f.board.touchEnd(); assert.deepEqual(f.events, []);
  f.start(); f.board.touchCancel(); f.measure(); t.mock.timers.tick(1000); assert.deepEqual(f.events, []); assert.equal(f.board.gesture, null);
});

test('a fast tap waits for hit testing instead of being mistaken for empty board space', t => {
  const f = gestureFixture(t, {}, true); f.start(); f.board.touchEnd(); assert.deepEqual(f.events, []);
  f.measure(); t.mock.timers.tick(1000); assert.deepEqual(f.events, [{ name: 'memory', detail: { id: f.item.memoryId } }]);
});

test('read-only boards allow tap viewing but do not edit or open a card after holding', t => {
  const f = gestureFixture(t, { canEdit: false }); f.start(); t.mock.timers.tick(1000); f.board.touchEnd(); assert.deepEqual(f.events, []);
  f.start(); f.board.touchEnd(); assert.deepEqual(f.events.map(e => e.name), ['memory']); assert.equal(f.board.data.editable, false);
});

test('delete control requests removal of the selection without transforming or opening a card', t => {
  const f = gestureFixture(t), p = f.board, tap = op => p.transform({ currentTarget: { dataset: { op } } });
  f.start(); t.mock.timers.tick(650); p.touchEnd(); f.events.length = 0;
  tap('remove'); assert.deepEqual(f.events, [{ name: 'remove', detail: { id: f.item.memoryId } }]);
  f.events.length = 0;
  for (const [key, value] of Object.entries({ covered: true, interactive: false, canEdit: false, editable: false, selected: '', landingId: 'in-flight' })) {
    const original = p.data[key]; p.data[key] = value; tap('remove'); p.data[key] = original;
  }
  p.dead = true; tap('remove'); p.dead = false;
  assert.deepEqual(f.events, []);
  tap('cw'); assert.deepEqual(f.events, [{ name: 'transform', detail: { op: 'cw' } }]);
});
