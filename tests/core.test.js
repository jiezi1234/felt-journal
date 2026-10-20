const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, KEY, validate } = require('../miniprogram/core/store');
const geometry = require('../miniprogram/core/geometry');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
function fixture() {
  const disk = {}; let fail = false;
  const storage = { get: key => disk[key], set(key, value) { if (fail) throw new Error('quota exceeded'); disk[key] = value; } };
  return { disk, storage, store: createStore(storage), fail(value) { fail = value; } };
}
const photos = name => ({ originalPath: `/local/${name}_original.jpg`, subjectPath: `/local/${name}_subject.png`, width: 400, height: 300, kind: 'extracted' });
test('record -> transform/color -> restart preserves exact model and independent image references', () => {
  const f = fixture(), today = dates.key(), id = f.store.add('one', today, photos('one'));
  const b = f.store.board(today); b.placements[0] = geometry.transform(b.placements[0], 'cw'); b.placements[0].x += 200; b.color = config.colors[1].value; f.store.saveBoard(b);
  const restored = createStore(f.storage); restored.load();
  assert.deepEqual(restored.board(today), b); assert.equal(restored.get().memories[id].originalPath, '/local/one_original.jpg'); validate(restored.get());
});
test('duplicate callback creates one memory and one placement', () => {
  const { store } = fixture(), today = dates.key(); const id = store.add('same', today, photos('same'));
  assert.equal(store.add('same', today, photos('other')), id); assert.equal(store.board(today).placements.length, 1); assert.equal(Object.keys(store.get().memories).length, 1);
});
test('failed atomic add leaves previous snapshot intact; retry adds exactly once', () => {
  const f = fixture(), today = dates.key(); f.store.add('first', today, photos('first')); const old = f.disk[KEY]; f.fail(true);
  assert.throws(() => f.store.add('second', today, photos('second')), /quota/); assert.equal(f.disk[KEY], old); assert.equal(f.store.board(today).placements.length, 1);
  f.fail(false); f.store.add('second', today, photos('second')); assert.equal(f.store.board(today).placements.length, 2);
});
test('replace keeps exact placement, failed replace keeps original content, delete updates all references', () => {
  const f = fixture(), today = dates.key(), id = f.store.add('first', today, photos('first')); const p = f.store.board(today).placements[0];
  f.fail(true); assert.throws(() => f.store.replace('replace', id, photos('next'))); assert.equal(f.store.get().memories[id].originalPath, photos('first').originalPath);
  f.fail(false); f.store.replace('replace', id, photos('next')); f.store.replace('replace', id, photos('ignored')); assert.deepEqual(f.store.board(today).placements[0], p);
  f.store.edit(id, '', '未分类'); f.store.remove(id); assert.equal(f.store.view(today).items.length, 0); assert.equal(Object.keys(f.store.get().memories).length, 0); assert.equal(f.store.get().garbage.length, 4);
});
test('adding to locked target date never uses current date, reading history never creates a board', () => {
  const f = fixture(); f.store.board('2024-02-29'); assert.equal(Object.keys(f.store.get().boards).length, 0); assert.equal(f.store.canEdit('2024-02-29'), false);
  f.store.add('started-before-midnight', '2024-02-29', photos('old')); assert.equal(f.store.get().memories.m_started_before_midnight, undefined);
  assert.equal(f.store.get().memories['m_started-before-midnight'].date, '2024-02-29'); assert.equal(f.store.board(dates.key()).placements.length, 0);
});
test('all angles and edge moves fit inside felt, only selected item changes', () => {
  const f = fixture(), today = dates.key(); f.store.add('a', today, photos('a')); f.store.add('b', today, photos('b'));
  const b = f.store.board(today), unchanged = { ...b.placements[1] };
  for (let angle = 0; angle < 360; angle += 15) {
    const p = geometry.fit({ ...b.placements[0], width: 1600, height: 1200, x: -2000, y: 4000, angle }), box = geometry.extent(p);
    assert.ok(p.x - box.w / 2 >= 0); assert.ok(p.y - box.h / 2 >= 0); assert.ok(p.x + box.w / 2 <= geometry.W + 0.001); assert.ok(p.y + box.h / 2 <= geometry.H + 0.001);
    b.placements[0] = p; f.store.saveBoard(b);
  }
  assert.deepEqual(f.store.board(today).placements[1], unchanged);
});
test('three 44px controls stay visible and separated for small, large and rotated edge stickers', () => {
  for (const screen of [240, 288, 320, 350, 390, 430]) for (const height of [screen * 2 / 3, screen * 1.8]) for (const size of [110, 800]) for (const angle of [0, 45, 90]) for (const x of [-500, 0, geometry.W, 2000]) for (const y of [-500, 0, geometry.H, 2000]) {
    const p = geometry.fit({ width: size, height: size * .7, x, y, angle }); const hs = geometry.handles(p, screen, height).map(h => h.style.match(/[\d.]+/g).map(Number));
    assert.equal(hs.length, 3);
    for (const [left, top] of hs) { assert.ok(left >= 0 && left + 44 <= screen + 0.001); assert.ok(top >= 0 && top + 44 <= height + 0.001); }
    for (let a = 0; a < hs.length; a++) for (let b = a + 1; b < hs.length; b++) assert.ok(Math.abs(hs[a][0] - hs[b][0]) >= 44 || Math.abs(hs[a][1] - hs[b][1]) >= 44);
  }
});
test('drag controls preserve aspect ratio, support fractional angles and enforce size and board bounds', () => {
  const p = geometry.create('test', 400, 300, 0, 1), center = { x: 180, y: 300 }, start = { x: 240, y: 360 };
  const resized = ratio => geometry.dragControl(p, 'resize', center, start, { x: center.x + 60 * ratio, y: center.y + 60 * ratio });
  for (const ratio of [0, .4, 1.125, 2, 100]) {
    const next = resized(ratio);
    assert.ok(Math.abs(next.width / next.height - 4 / 3) < .001);
    assert.ok(next.width >= config.minSize && next.width <= config.maxSize);
  }
  assert.equal(resized(1.125).width, p.width * 1.125);
  for (const degrees of [-181.3, -23.7, .5, 37.2, 179.9, 361.3]) {
    const radians = (45 + degrees) * Math.PI / 180, radius = Math.hypot(60, 60);
    const next = geometry.dragControl(p, 'rotate', center, start, { x: center.x + radius * Math.cos(radians), y: center.y + radius * Math.sin(radians) });
    assert.ok(Math.abs(next.angle - ((degrees % 360) + 360) % 360) < .001);
    assert.equal(next.width, p.width);
  }
  assert.equal(geometry.dragControl(p, 'rotate', center, start, center), null, 'The center does not produce a random angle');
  const edge = geometry.fit({ ...p, x: -200, y: -200 });
  for (const op of ['resize', 'rotate']) {
    const next = geometry.dragControl(edge, op, center, start, { x: 400, y: 100 }), e = geometry.extent(next);
    assert.ok(next.x - e.w / 2 >= 0 && next.x + e.w / 2 <= geometry.W);
    assert.ok(next.y - e.h / 2 >= 0 && next.y + e.h / 2 <= geometry.H);
  }
});
test('leap year, Monday-first calendar, year rollover, stable two-item previews', () => {
  assert.ok(dates.valid('2024-02-29')); assert.ok(!dates.valid('2023-02-29')); assert.deepEqual(dates.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  const cells = dates.monthCells(2024, 2, '2024-02-20', { '2024-02-01': [1, 2, 3] }); assert.equal(cells.filter(c => !c.blank).length, 29); assert.equal(cells[3].day, 1); assert.deepEqual(cells[3].images, [1, 2]); assert.ok(cells.find(c => c.day === 21).future);
});
test('corrupted storage is preserved and rejected; drafts do not replace last saved layout', () => {
  const f = fixture(); f.disk[KEY] = '{broken'; assert.throws(() => f.store.load()); assert.equal(f.disk[KEY], '{broken');
  delete f.disk[KEY]; f.store.load(); f.store.add('a', dates.key(), photos('a')); const b = f.store.board(dates.key()), old = f.store.board(dates.key()); b.placements[0].x += 50; f.store.keepDraft(b); assert.deepEqual(f.store.getDraft(dates.key()), b); assert.deepEqual(f.store.board(dates.key()), old);
  f.store.saveBoard(b); assert.equal(f.store.getDraft(dates.key()), undefined);
});
test('stale board cannot restore deleted memory', () => {
  const f = fixture(), id = f.store.add('a', dates.key(), photos('a')), draft = f.store.board(dates.key()); f.store.remove(id); assert.throws(() => f.store.saveBoard(draft), /记忆已变化/); assert.equal(f.store.board(dates.key()).placements.length, 0);
});
test('wrong collection shapes are rejected without overwriting damaged storage', () => {
  const f = fixture(), malformed = { ...f.store.get(), boards: [], memories: [] };
  f.disk[KEY] = JSON.stringify(malformed); const raw = f.disk[KEY];
  assert.throws(() => createStore(f.storage).add('a', dates.key(), photos('a')), /格式异常/); assert.equal(f.disk[KEY], raw);
});
test('deleting a memory also clears its unsaved text and placement drafts', () => {
  const f = fixture(), date = dates.key(), id = f.store.add('a', date, photos('a'));
  f.store.keepMemoryDraft(id, { text: 'unsaved personal text', category: 1 }); f.store.keepDraft(f.store.board(date));
  f.store.remove(id); assert.equal(f.store.getMemoryDraft(id), undefined); assert.equal(f.store.getDraft(date), undefined);
});
