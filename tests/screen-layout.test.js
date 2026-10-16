const test = require('node:test');
const assert = require('node:assert/strict');
const { present } = require('../miniprogram/core/board-viewport');
const geometry = require('../miniprogram/core/geometry');
const config = require('../miniprogram/core/config');
const search = require('../miniprogram/core/memory-query');
const renderer = require('../miniprogram/core/renderer');
const { createCanvas } = require('@napi-rs/canvas');

test('portrait preview preserves photo proportions, hit targets and stored layout at every edge', () => {
  const items = [];
  for (const angle of [0, 45, 90, 225]) for (const x of [0, geometry.W]) for (const y of [0, geometry.H]) {
    items.push({ ...geometry.fit({ x, y, width: 380, height: 240, angle }), memoryId: String(items.length), memory: { subjectPath: '/image' } });
  }
  const model = { items, color: config.colors[0].value }, before = JSON.stringify(model);
  for (const [width, height] of [[296, 260], [351, 440], [366, 487], [406, 600]]) {
    const display = present(model, width, height), innerHeight = display.dimensions.height - config.board.inset * 2;
    display.model.items.forEach((item, index) => {
      const original = model.items[index], box = geometry.extent(item);
      assert.equal(item.width, original.width); assert.equal(item.height, original.height); assert.equal(item.angle, original.angle);
      assert.ok(item.y >= box.h / 2 && item.y + box.h / 2 <= innerHeight);
      assert.equal(geometry.hit(item, item.x, item.y), true);
    });
    const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
    ctx.scale(width / display.dimensions.width, height / display.dimensions.height);
    renderer.paint(ctx, display.model, {}, '', display.dimensions);
    assert.ok(canvas.toBuffer('image/png').length > 1000);
  }
  assert.equal(JSON.stringify(model), before);
});

test('compact pagination reaches every memory once across dates and clamps after removal', () => {
  const state = { memories: {} }, today = '2026-10-16';
  for (let i = 0; i < 25; i++) state.memories['m' + i] = { id: 'm' + i, date: i % 2 ? today : '2026-09-01', category: '饮食', createdAt: i, text: '', subjectPath: '/image' };
  const all = [], snapshot = JSON.stringify(state);
  for (let page = 1; page <= 7; page++) {
    const result = search.query(state, { page, pageSize: 4 }, today), items = result.groups.flatMap(g => g.items);
    assert.equal(result.pageCount, 7); assert.ok(items.length <= 4); all.push(...items.map(i => i.id));
  }
  assert.equal(new Set(all).size, 25); assert.equal(JSON.stringify(state), snapshot);
  delete state.memories[all.at(-1)];
  assert.equal(search.query(state, { page: 7, pageSize: 4 }, today).page, 6);
});
