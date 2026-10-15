const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoardHistory } = require('../miniprogram/core/board-history');
const { createStore, clone } = require('../miniprogram/core/store');
const geometry = require('../miniprogram/core/geometry');
const layers = require('../miniprogram/core/layers');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
const { paint } = require('../miniprogram/core/renderer');
const { createCanvas } = require('@napi-rs/canvas');

function fixture() {
  const disk = {}, storage = { get: key => disk[key], set: (key, value) => { disk[key] = value; } };
  const store = createStore(storage), date = dates.key();
  for (const name of ['a', 'b', 'c']) store.add(name, date, { originalPath: `/${name}.jpg`, subjectPath: `/${name}.png`, width: 400, height: 300, kind: 'extracted' });
  return { store, storage, date, board: store.board(date) };
}
test('layout history stores independent snapshots and caps undo depth', () => {
  const { board } = fixture(), history = createBoardHistory(board, 2);
  board.placements[0].x += 50; history.record(board);
  board.placements[0] = geometry.transform(board.placements[0], 'cw'); history.record(board);
  board.color = config.colors[1].value; history.record(board);
  const a = history.undo(); assert.equal(a.color, config.colors[0].value); assert.equal(a.placements[0].angle, 15);
  a.placements[0].angle = 200; // Caller mutation must not corrupt the redo snapshot.
  assert.equal(history.undo().placements[0].angle, 0); assert.equal(history.undo(), null);
  assert.equal(history.redo().placements[0].angle, 15); assert.equal(history.redo().color, config.colors[1].value);
  assert.equal(history.redo(), null);
});
test('no-op keeps redo available while a new adjustment discards the redo branch', () => {
  const { board } = fixture(), history = createBoardHistory(board);
  const next = clone(board); next.color = config.colors[1].value; history.record(next);
  history.undo(); assert.equal(history.record(clone(board)), false); assert.equal(history.status().canRedo, true);
  board.color = config.colors[2].value; history.record(board); assert.equal(history.status().canRedo, false);
  assert.equal(history.undo().color, config.colors[0].value);
});
test('membership or board changes reset history, unchanged refresh preserves it', () => {
  const { board } = fixture(), history = createBoardHistory(board);
  const next = clone(board); next.color = config.colors[1].value; history.record(next);
  history.sync(clone(next)); assert.equal(history.status().canUndo, true);
  next.placements.pop(); history.sync(next); assert.equal(history.undo(), null);
  next.color = config.colors[2].value; history.record(next);
  history.record({ ...next, id: '2024-01-01', date: '2024-01-01' }); assert.equal(history.undo(), null);
});
test('front/back preserve geometry, images and calendar order with tied layers', () => {
  const { store, storage, date, board } = fixture();
  board.placements.forEach(p => { p.z = 1; }); store.saveBoard(board);
  const old = clone(board), calendarIds = b => b.placements.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).map(p => p.memoryId);
  const moved = layers.move(board, 'm_a', 'front');
  assert.deepEqual(layers.ordered(moved.placements).map(p => p.memoryId), ['m_b', 'm_c', 'm_a']);
  assert.deepEqual(board, old); assert.deepEqual(calendarIds(moved), calendarIds(old));
  moved.placements.forEach((p, i) => assert.deepEqual({ ...p, z: 0 }, { ...old.placements[i], z: 0 }));
  store.saveBoard(moved); const restored = createStore(storage);
  assert.deepEqual(restored.view(date).items.map(p => p.memoryId), ['m_b', 'm_c', 'm_a']);
  assert.strictEqual(layers.move(moved, 'm_a', 'front'), moved);
  assert.strictEqual(layers.move(moved, 'missing', 'back'), moved);
  const bottom = layers.move(moved, 'm_a', 'back');
  assert.deepEqual(layers.ordered(bottom.placements).map(p => p.memoryId), ['m_a', 'm_b', 'm_c']);
  assert.deepEqual(layers.availability(bottom, 'm_a'), { canBringToFront: true, canSendToBack: false });
});
test('rendered overlap follows persisted layer order and undo restores original top object', () => {
  const { store, date, board } = fixture(), history = createBoardHistory(board), images = {};
  for (const [id, color] of [['a', '#FF0000'], ['b', '#00FF00'], ['c', '#0000FF']]) {
    const canvas = createCanvas(400, 300), context = canvas.getContext('2d'); context.fillStyle = color; context.fillRect(0, 0, 400, 300); images[`/${id}.png`] = canvas;
  }
  function center(width) {
    const canvas = createCanvas(width, width * 2 / 3), context = canvas.getContext('2d'); context.scale(width / 1500, width / 1500);
    paint(context, store.view(date), images, ''); return Array.from(context.getImageData(width / 2, width / 3, 1, 1).data).slice(0, 3);
  }
  assert.deepEqual(center(390), [0, 0, 255]);
  const next = layers.move(board, 'm_a', 'front'); history.record(next); store.saveBoard(next);
  for (const width of [288, 390, 1800]) assert.deepEqual(center(width), [255, 0, 0]);
  store.saveBoard(history.undo()); assert.deepEqual(center(1800), [0, 0, 255]);
});
