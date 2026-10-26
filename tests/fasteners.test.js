const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { createStore, KEY, clone, validate } = require('../miniprogram/core/store');
const styles = require('../miniprogram/core/fastener-style');
const hardware = require('../miniprogram/core/sticker-fastener');
const material = require('../miniprogram/core/board-material');
const renderer = require('../miniprogram/core/renderer');
const geometry = require('../miniprogram/core/geometry');
const { createBoardHistory } = require('../miniprogram/core/board-history');
const dates = require('../miniprogram/core/date');
const B = require('../miniprogram/core/config').board;
const photos = { originalPath: '/original.png', subjectPath: '/subject.png', width: 400, height: 300 };
function fixture() {
  const disk = {}, storage = { get: key => disk[key], set: (key, value) => { disk[key] = value; } };
  return { disk, storage, store: createStore(storage), date: dates.key() };
}
test('placing chooses hardware once; canceling an unplaced result and duplicate callbacks never choose again', t => {
  const f = fixture(); let calls = 0;
  t.mock.method(Math, 'random', () => { calls++; return .45; });
  const id = f.store.add('pending', f.date, photos, f.date, { deferPlacement: true });
  assert.equal(calls, 0); assert.equal(f.store.board(f.date).placements.length, 0);
  f.store.place(id, f.date); const chosen = f.store.board(f.date).placements[0].fastener;
  assert.equal(chosen.kind, 'clip'); assert.ok(styles.valid(chosen));
  const after = calls; f.store.place(id, f.date); f.store.add('pending', f.date, photos);
  assert.equal(calls, after); assert.deepEqual(f.store.board(f.date).placements[0].fastener, chosen);
});
test('hardware stays with each placement across edits, undo, replacement and reload; re-placing gets a new choice', t => {
  const f = fixture(); let random = .05;
  t.mock.method(Math, 'random', () => random);
  const id = f.store.add('fixed', f.date, photos), daily = f.store.board(f.date), history = createBoardHistory(daily);
  assert.equal(daily.placements[0].fastener.kind, 'pin');
  random = .92; const theme = f.store.createTheme('mixed', '旅行', id), themeHardware = f.store.board(theme).placements[0].fastener;
  assert.equal(themeHardware.kind, 'paperclip');
  const edited = clone(daily); edited.placements[0] = geometry.transform(edited.placements[0], 'cw');
  history.record(edited); f.store.saveBoard(edited);
  f.store.saveBoard(history.undo()); f.store.saveBoard(history.redo());
  f.store.replace('replacement', id, { ...photos, subjectPath: '/new.png' });
  const reloaded = createStore(f.storage);
  assert.deepEqual(reloaded.board(f.date).placements[0].fastener, daily.placements[0].fastener);
  assert.deepEqual(reloaded.board(theme).placements[0].fastener, themeHardware);
  random = .5; reloaded.unplace(id, theme); reloaded.place(id, theme);
  assert.equal(reloaded.board(theme).placements[0].fastener.kind, 'clip');
  assert.deepEqual(reloaded.board(f.date).placements[0].fastener, daily.placements[0].fastener);
});
test('legacy hardware is stable without random calls or writes, while invalid saved styles are rejected', t => {
  const f = fixture(), id = f.store.add('old', f.date, photos), old = f.store.get();
  delete old.boards[f.date].placements[0].fastener; f.disk[KEY] = JSON.stringify(old);
  const before = f.disk[KEY], p = createStore(f.storage).board(f.date).placements[0];
  t.mock.method(Math, 'random', () => { throw Error('Rendering must not choose randomly'); });
  assert.deepEqual(styles.of(p), styles.of(JSON.parse(JSON.stringify(p)))); assert.ok(styles.valid(styles.of(p)));
  assert.equal(f.disk[KEY], before); assert.equal(p.fastener, undefined);
  for (const fastener of [{ kind: 'unknown', color: 'sage', rotation: 0 }, { kind: 'pin', color: 'invalid', rotation: 0 }, { kind: 'clip', color: 'clay', rotation: NaN }]) {
    const bad = clone(old); bad.boards[f.date].placements[0].fastener = fastener; assert.throws(() => validate(bad), /固定件/);
  }
  assert.equal(p.memoryId, id);
});
test('all three hardware types and every palette color can be chosen', () => {
  const found = new Set();
  for (let kind = 0; kind < 3; kind++) for (let color = 0; color < 10; color++) {
    const values = [(kind + .5) / 3, (color + .5) / 10, .5], chosen = styles.choose(() => values.shift());
    assert.ok(styles.valid(chosen)); found.add(`${chosen.kind}:${chosen.color}`);
  }
  for (const [kind, colors] of Object.entries(styles.palettes)) for (const color of colors) assert.ok(found.has(`${kind}:${color}`));
});
test('clips attach at the visible cutout edge and the rear paperclip wire is occluded by the photo', () => {
  const image = createCanvas(200, 200), ink = image.getContext('2d'); ink.fillStyle = '#F066B7'; ink.fillRect(80, 60, 100, 140);
  const anchor = material.anchorOf(image); assert.equal(anchor.edgeY, .3);
  const h = hardware.layout({ width: 200, height: 200 }, { angle: 0, fastener: { kind: 'paperclip', color: 'brass', rotation: 0 } }, image);
  assert.equal(h.y, -40);
  const c = createCanvas(240, 240), ctx = c.getContext('2d'); ctx.translate(120, 120);
  hardware.paint(ctx, h, 1, 'back'); ctx.drawImage(image, -100, -100); hardware.paint(ctx, h);
  const pixel = (x, y) => [...ctx.getImageData(Math.round(120 + h.x + h.radius * x), Math.round(120 + h.y + h.radius * y), 1, 1).data];
  assert.deepEqual(pixel(-.77, 1), [240, 102, 183, 255], 'The image covers the long rear wire');
  assert.notDeepEqual(pixel(.52, .6), [240, 102, 183, 255], 'The shorter front loop remains above the image');
  assert.ok(pixel(.52, -.7)[3] > 0, 'The upper loop extends beyond the cutout edge');
});
test('mixed fasteners are identical on redraw, cached preview and export without mutating the model or image', () => {
  const image = createCanvas(400, 300), ink = image.getContext('2d'); ink.fillStyle = '#A9BF97'; ink.fillRect(0, 0, 400, 300);
  const items = ['pin', 'clip', 'paperclip'].map((kind, index) => ({ memoryId: `m${index}`, x: 260 + index * 440, y: 480, width: 350, height: 280,
    angle: [-16, 0, 22][index], fastener: { kind, color: styles.palettes[kind][0], rotation: 5 }, memory: { subjectPath: 'image' } }));
  const model = { color: '#D9CBAF', texture: 'fine', items }, original = JSON.stringify(model), source = image.toBuffer('image/png');
  for (const width of [320, 430, 1800]) {
    const bounds = renderer.frame(), height = Math.round(width * bounds.height / bounds.width), c = createCanvas(width, height);
    const cached = renderer.createSurface(c, model, B, null, ({ width, height }) => createCanvas(width, height));
    const draw = surface => { const ctx = c.getContext('2d'), sy = height / bounds.height; ctx.setTransform(width / B.width, 0, 0, sy, 0, bounds.top * sy); renderer.paint(ctx, model, { image }, '', B, surface); return [...ctx.getImageData(0, 0, width, height).data]; };
    const direct = draw(); assert.deepEqual(draw(), direct);
    const preview = draw(cached.canvas); assert.ok(preview.every((v, i) => Math.abs(v - direct[i]) <= 2));
  }
  assert.equal(JSON.stringify(model), original); assert.deepEqual(image.toBuffer('image/png'), source);
});
