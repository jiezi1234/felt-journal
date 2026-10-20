const test = require('node:test');
const assert = require('node:assert/strict');
const g = require('../miniprogram/core/geometry');
const { createStore } = require('../miniprogram/core/store');
function overlaps(a, b) {
  const x = g.extent(a), y = g.extent(b);
  return Math.abs(a.x - b.x) < (x.w + y.w) / 2 - 0.01 && Math.abs(a.y - b.y) < (x.h + y.h) / 2 - 0.01;
}
test('incoming mixed-size stickers use free space without moving earlier stickers', () => {
  const items = [];
  for (let i = 0; i < 8; i++) {
    const before = JSON.stringify(items), p = g.create('m' + i, i % 2 ? 800 : 400, 600, i, i, items);
    assert.equal(JSON.stringify(items), before);
    assert.deepEqual(g.fit(p), p);
    assert.ok(items.every(other => !overlaps(p, other)), 'New sticker overlaps existing work at ' + i);
    items.push(p);
  }
  assert.equal(Math.max(items[0].width, items[0].height), 560);
});
test('rotated and crowded boards get finite, bounded, deterministic placements', () => {
  const large = g.fit({ x: 705, y: 455, width: 1100, height: 700, angle: 28 });
  const items = [large];
  for (let i = 0; i < 29; i++) items.push(g.create('m' + i, 200, 300, i, i, items));
  const p = g.create('last', 400, 100, 30, 30, items);
  assert.deepEqual(g.fit(p), p);
  assert.ok(['x', 'y', 'width', 'height'].every(k => Number.isFinite(p[k]) && p[k] > 0));
  assert.deepEqual(g.create('last', 400, 100, 30, 30, items), p);
});
test('both new photos and library placements use free space and leave saved layouts intact', () => {
  const disk = {}, store = createStore({ get: k => disk[k], set: (k, v) => { disk[k] = v; } });
  const photo = { originalPath: '/original.jpg', subjectPath: '/cutout.png', width: 400, height: 300 };
  const one = store.add('one', '2026-10-01', photo), before = store.board('2026-10-01').placements[0];
  const two = store.add('two', '2026-10-01', photo);
  const daily = store.board('2026-10-01').placements;
  assert.deepEqual(daily[0], before); assert.ok(!overlaps(daily[0], daily[1]));
  const theme = store.createTheme('collection', '收藏'); store.place(one, theme); store.place(two, theme);
  const placed = store.board(theme).placements;
  assert.ok(!overlaps(placed[0], placed[1])); assert.deepEqual(store.board('2026-10-01').placements, daily);
});
