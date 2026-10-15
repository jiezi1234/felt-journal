const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const config = require('../miniprogram/core/config');
const felt = require('../miniprogram/core/felt');
const { paint } = require('../miniprogram/core/renderer');
const { createStore, KEY, DRAFT, clone } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
function fixture() {
  const disk = {}, storage = { get: key => disk[key], set: (key, value) => { disk[key] = value; } }, store = createStore(storage), date = dates.key();
  store.add('one', date, { originalPath: '/original.jpg', subjectPath: '/subject.png', width: 400, height: 300, kind: 'extracted' });
  return { store, disk, storage, date };
}
function render(width, color, texture) {
  const canvas = createCanvas(width, width * 2 / 3), ctx = canvas.getContext('2d'); ctx.scale(width / 1500, width / 1500);
  paint(ctx, { color, texture, items: [] }, {}, ''); return canvas;
}
test('legacy board/draft gain fine texture in memory without writing or changing saved data', () => {
  const { store, disk, storage, date } = fixture(), old = store.get(); delete old.boards[date].texture; disk[KEY] = JSON.stringify(old);
  disk[DRAFT] = JSON.stringify({ [date]: old.boards[date] }); const before = { ...disk }, restored = createStore(storage);
  assert.equal(restored.board(date).texture, 'fine'); assert.equal(restored.view(date).texture, 'fine');
  assert.equal(restored.getDraft(date).texture, 'fine'); assert.deepEqual(restored.board(date), restored.getDraft(date)); assert.deepEqual(disk, before);
  assert.equal(restored.get().boards[date].texture, undefined);
  const emptyBefore = restored.get(); assert.equal(restored.board('2024-01-01').texture, 'fine'); assert.deepEqual(restored.get(), emptyBefore);
});
test('all color/texture combinations persist across restart and leave memories and placements untouched', () => {
  const { store, storage, date } = fixture(), before = store.get();
  for (const color of config.colors) for (const texture of config.textures) {
    const board = store.board(date); board.color = color.value; board.texture = texture.value; store.saveBoard(board);
    const state = createStore(storage).get(); assert.equal(state.boards[date].color, color.value); assert.equal(state.boards[date].texture, texture.value);
    assert.deepEqual(state.boards[date].placements, before.boards[date].placements); assert.deepEqual(state.memories, before.memories); assert.deepEqual(state.garbage, before.garbage);
  }
});
test('invalid texture cannot corrupt a saved board; invalid persisted metadata remains untouched', () => {
  const { store, disk, storage, date } = fixture(), before = store.get();
  for (const texture of ['', 'unknown', null, {}, 1]) {
    assert.throws(() => store.saveBoard({ ...store.board(date), texture }), /纹理/); assert.deepEqual(store.get(), before);
    const invalid = clone(before); invalid.boards[date].texture = texture; disk[KEY] = JSON.stringify(invalid); const raw = disk[KEY];
    assert.throws(() => createStore(storage).load(), /纹理/); assert.equal(disk[KEY], raw);
  }
});
test('fine texture retains original fiber algorithm and legacy/new renders are pixel-identical', () => {
  const actual = createCanvas(1500, 1000), expected = createCanvas(1500, 1000), ctx = expected.getContext('2d');
  felt.paintTexture(actual.getContext('2d'), 'fine', 45, 45, 1410, 910);
  ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(88,72,47,0.075)'; ctx.beginPath();
  for (let n = 0; n < 1600; n++) { const x = 45 + (n * 137.51 % 1410), y = 45 + (n * 73.17 % 910); ctx.moveTo(x, y); ctx.lineTo(x + n % 3 + 2, y + (n % 2 ? 3 : -3)); } ctx.stroke();
  assert.deepEqual(actual.toBuffer('image/png'), expected.toBuffer('image/png'));
  for (const width of [288, 390, 1800]) assert.deepEqual(render(width, '#D9CBAF').toBuffer('image/png'), render(width, '#D9CBAF', 'fine').toBuffer('image/png'));
});
test('all textures are distinct, deterministic, clipped to felt and preserve frame at preview/export sizes', () => {
  for (const width of [288, 390, 1800]) for (const color of config.colors) {
    const outputs = new Set();
    for (const texture of config.textures) {
      const canvas = render(width, color.value, texture.value), bytes = canvas.toBuffer('image/png'); outputs.add(bytes.toString('base64'));
      assert.deepEqual(bytes, render(width, color.value, texture.value).toBuffer('image/png'));
      const ctx = canvas.getContext('2d'), scale = width / 1500;
      for (const [x, y] of [[20, 500], [1480, 500], [750, 20], [750, 980]]) assert.deepEqual(Array.from(ctx.getImageData(Math.floor(x * scale), Math.floor(y * scale), 1, 1).data), [73, 53, 39, 255]);
      assert.deepEqual(Array.from(ctx.getImageData(0, 0, 1, 1).data), [232, 237, 231, 255]);
    }
    assert.equal(outputs.size, 3);
  }
});
test('sample preview is the same section of material used on the board', () => {
  for (const texture of config.textures) {
    const sample = createCanvas(260, 140); felt.paintSample(sample.getContext('2d'), 260, 140, '#DDC7C1', texture.value);
    const board = render(1500, '#DDC7C1', texture.value);
    const actual = sample.getContext('2d').getImageData(0, 0, 260, 140).data, expected = board.getContext('2d').getImageData(240, 260, 260, 140).data;
    let maximum = 0, sum = 0;
    actual.forEach((value, index) => { const difference = Math.abs(value - expected[index]); maximum = Math.max(maximum, difference); sum += difference; });
    // Rasterizing translated paths can round edge coverage differently. Permit
    // at most four channel levels and a tiny aggregate error, not a shifted pattern.
    assert.ok(maximum <= 4 && sum / actual.length < 0.03, `${texture.value}: max=${maximum}, mean=${sum / actual.length}`);
  }
});
