const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const edit = require('../miniprogram/core/photo-edit');
const { createStore, KEY } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const platform = require('../miniprogram/services/platform');
const { SubjectEditTask } = require('../miniprogram/services/subject-edit');
const photo = { originalPath: '/original.jpg', subjectPath: '/subject.png', width: 400, height: 300, kind: 'extracted' };
function fixture(t) {
  const originals = { ...platform }; t.after(() => Object.assign(platform, originals));
  const disk = {}, deleted = []; let fail = false;
  const storage = { get: key => disk[key], set(key, value) { if (fail && key === KEY) throw new Error('disk full'); disk[key] = value; } };
  const store = createStore(storage), date = dates.key(), id = store.add('one', date, photo);
  store.edit(id, '保留文字', '日常');
  platform.persist = async (path, name) => `/local/${name}.png`;
  platform.call = async () => ({ width: 200, height: 150 });
  platform.releaseFiles = () => {}; platform.unlink = async path => { deleted.push(path); }; platform.collect = async () => {};
  return { store, date, id, disk, storage, deleted, fail(value) { fail = value; }, task() { return new SubjectEditTask(store, id, { ...photo }); } };
}
function source() {
  const image = createCanvas(80, 60), ctx = image.getContext('2d');
  ctx.fillStyle = '#FF0000'; ctx.fillRect(0, 0, 40, 30); ctx.fillStyle = '#00FF00'; ctx.fillRect(40, 0, 40, 30); ctx.fillStyle = '#0000FF'; ctx.fillRect(0, 30, 40, 30);
  return image; // bottom-right stays transparent
}
const sample = (canvas, x, y) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data);
test('PNG crop preserves exact content, alpha, rotation and horizontal mirror', () => {
  const image = source(), canvas = createCanvas(1, 1);
  let state = edit.initial(80, 60); state.crop = { x: 40, y: 30, width: 40, height: 30 };
  assert.deepEqual(edit.render(canvas, image, state), { width: 40, height: 30 }); assert.deepEqual(sample(canvas, 10, 10), [0, 0, 0, 0]);
  state = edit.rotate(edit.initial(80, 60), { width: 80, height: 60 }); edit.render(canvas, image, state);
  assert.equal(canvas.width, 60); assert.equal(canvas.height, 80);
  assert.deepEqual(sample(canvas, 10, 10), [0, 0, 255, 255]); assert.deepEqual(sample(canvas, 50, 10), [255, 0, 0, 255]);
  state = edit.mirror(state, { width: 60, height: 80 }); edit.render(canvas, image, state);
  assert.deepEqual(sample(canvas, 10, 10), [255, 0, 0, 255]); assert.deepEqual(sample(canvas, 50, 70), [0, 0, 0, 0]);
});
test('rotate after mirror rotates the visible pixels clockwise and keeps the selected content', () => {
  const image = source(), canvas = createCanvas(1, 1);
  let state = edit.initial(80, 60); state.crop = { x: 0, y: 0, width: 40, height: 30 };
  state = edit.mirror(state, edit.size(80, 60, state.turn)); state = edit.rotate(state, edit.size(80, 60, state.turn));
  edit.render(canvas, image, state); assert.equal(canvas.width, 30); assert.equal(canvas.height, 40); assert.deepEqual(sample(canvas, 15, 20), [255, 0, 0, 255]);
  state = edit.mirror(edit.initial(80, 60), { width: 80, height: 60 }); state = edit.rotate(state, { width: 80, height: 60 }); edit.render(canvas, image, state);
  assert.deepEqual(sample(canvas, 10, 10), [0, 0, 0, 0]); assert.deepEqual(sample(canvas, 50, 10), [0, 255, 0, 255]);
});
test('corner drags preserve anchors and ratios and never leave image bounds', () => {
  const bounds = { width: 400, height: 300 };
  for (const ratio of [0, 1, 4 / 3, 3 / 4]) for (const handle of ['nw', 'ne', 'sw', 'se', 'move']) for (const dx of [-1000, -30, 30, 1000]) for (const dy of [-1000, -20, 20, 1000]) {
    const c = ratio ? edit.preset(bounds, ratio) : { x: 40, y: 30, width: 240, height: 180 }, result = edit.drag(c, handle, dx, dy, bounds, ratio);
    assert.ok(result.x >= -0.001 && result.y >= -0.001 && result.width > 0 && result.height > 0);
    assert.ok(result.x + result.width <= 400.001 && result.y + result.height <= 300.001);
    if (ratio) assert.ok(Math.abs(result.width / result.height - ratio) < 1e-8);
    if (handle === 'move') { assert.equal(result.width, c.width); assert.equal(result.height, c.height); }
    else { assert.ok(Math.abs((handle.includes('w') ? result.x + result.width - c.x - c.width : result.x - c.x)) < 1e-8); assert.ok(Math.abs((handle.includes('n') ? result.y + result.height - c.y - c.height : result.y - c.y)) < 1e-8); }
  }
});
test('four turns/two mirrors restore the edit and output does not upscale or exceed 2048', () => {
  let state = edit.initial(400, 300); const initial = JSON.parse(JSON.stringify(state));
  for (let n = 0; n < 4; n++) state = edit.rotate(state, edit.size(400, 300, state.turn));
  assert.deepEqual(state, initial); assert.equal(edit.changed(state, 400, 300), false);
  for (let n = 0; n < 2; n++) state = edit.mirror(state, edit.size(400, 300, state.turn));
  assert.deepEqual(state, initial);
  assert.deepEqual(edit.outputSize({ width: 8000, height: 6000 }), { width: 2048, height: 1536 }); assert.deepEqual(edit.outputSize({ width: 80, height: 60 }), { width: 80, height: 60 });
});
test('subject edit persists only new subject, preserves original/content/exact placement, is idempotent', async t => {
  const f = fixture(t), before = f.store.get(), task = f.task();
  assert.equal(await task.save(async () => '/render.png', 'extracted'), true);
  const state = f.store.get(), m = state.memories[f.id];
  assert.equal(m.originalPath, photo.originalPath); assert.equal(m.text, '保留文字'); assert.equal(m.category, '日常'); assert.equal(m.subjectEdited, true);
  assert.notEqual(m.subjectPath, photo.subjectPath); assert.deepEqual(state.boards, before.boards); assert.deepEqual(state.garbage, [photo.subjectPath]);
  assert.deepEqual(createStore(f.storage).get(), state); assert.equal(await task.save(async () => { throw new Error('must not run'); }, 'extracted'), false);
  f.store.editSubject(task.id, f.id, photo, { subjectPath: '/ignored.png', width: 20, height: 20 }); assert.deepEqual(f.store.get(), state);
  f.store.replace('replacement', f.id, { ...photo, originalPath: '/next.jpg', subjectPath: '/next.png' }); assert.equal(f.store.get().memories[f.id].subjectEdited, false);
});
test('storage failure leaves the old record intact, cleans uncommitted file, and allows retry', async t => {
  const f = fixture(t), before = f.store.get(), task = f.task(); f.fail(true);
  await assert.rejects(task.save(async () => '/render.png', 'extracted'), /disk full/); assert.deepEqual(f.store.get(), before); assert.equal(f.deleted.length, 1); assert.ok(!f.deleted.includes(photo.subjectPath));
  f.fail(false); assert.equal(await task.save(async () => '/render.png', 'extracted'), true); assert.equal(f.store.get().memories[f.id].subjectEdited, true);
});
test('unload during a late copy cannot commit or leak a file; duplicate save is ignored', async t => {
  const f = fixture(t), before = f.store.get(), task = f.task(); let finishCopy;
  platform.persist = () => new Promise(resolve => { finishCopy = resolve; });
  const saving = task.save(async () => '/render.png', 'extracted'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(await task.save(async () => { throw new Error('duplicate'); }, 'extracted'), false);
  await task.cancel(); finishCopy('/late.png'); assert.equal(await saving, false); assert.deepEqual(f.store.get(), before); assert.deepEqual(f.deleted, ['/late.png']);
});
test('render/decode errors and stale replacement/deletion never overwrite current records', async t => {
  const f = fixture(t), before = f.store.get();
  await assert.rejects(f.task().save(async () => { throw new Error('render failed'); }, 'extracted'), /render failed/); assert.deepEqual(f.store.get(), before);
  platform.call = async () => { throw new Error('decode failed'); }; await assert.rejects(f.task().save(async () => '/render.png', 'extracted'), /decode failed/); assert.deepEqual(f.store.get(), before); assert.equal(f.deleted.length, 1);
  platform.call = async () => ({ width: 200, height: 150 });
  const stale = f.task(); f.store.replace('replacement', f.id, { ...photo, originalPath: '/next.jpg', subjectPath: '/next.png' }); const replaced = f.store.get();
  await assert.rejects(stale.save(async () => '/render.png', 'extracted'), /照片已变化/); assert.deepEqual(f.store.get(), replaced);
  f.store.remove(f.id); const removed = f.store.get(); await assert.rejects(f.task().save(async () => '/render.png', 'extracted'), /已被删除/); assert.deepEqual(f.store.get(), removed);
});
