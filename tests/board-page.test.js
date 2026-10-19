const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
const platform = require('../miniprogram/services/platform');
let definition;
global.Page = page => { definition = page; };
require('../miniprogram/pages/board/index');
delete global.Page;
const event = value => ({ currentTarget: { dataset: value } });
const photos = id => ({ originalPath: `/${id}.jpg`, subjectPath: `/${id}.png`, width: 400, height: 300, kind: 'extracted' });
function fixture(t) {
  const originals = { ...platform }; t.after(() => Object.assign(platform, originals));
  platform.unloadGuard = () => {}; platform.toast = () => {}; platform.confirmDelete = async () => true; platform.confirmRemovePlacement = async () => true; platform.collect = async () => {};
  const disk = {}; let fail = false;
  const storage = { get: key => disk[key], set(key, value) { if (fail && key === KEY) throw new Error('disk full'); disk[key] = value; } };
  const store = createStore(storage), date = dates.key();
  const first = store.add('one', date, photos('one')), second = store.add('two', date, photos('two'));
  const page = Object.assign({}, definition, { data: clone(definition.data), store, date, wantEdit: true, cancelledGestures: 0,
    setData(update) { Object.assign(this.data, update); }, selectComponent() { return { touchCancel: () => { this.cancelledGestures++; } }; } });
  page.refresh(); page.select({ detail: { id: first } });
  return { page, store, date, first, second, storage, fail(value) { fail = value; } };
}
test('move/rotate/scale/color/texture/layer undo and redo persist each exact layout', t => {
  const { page: p, store, date, storage } = fixture(t), states = [clone(p.draft)];
  const moved = { ...p.data.model.items[0], x: p.data.model.items[0].x + 100 };
  p.placementChanged({ detail: { placement: moved } }); states.push(clone(p.draft));
  p.transform({ detail: { op: 'cw' } }); states.push(clone(p.draft));
  p.transform({ detail: { op: 'up' } }); states.push(clone(p.draft));
  p.color(event({ value: config.colors[1].value })); states.push(clone(p.draft));
  p.texture(event({ value: 'long' })); states.push(clone(p.draft));
  p.layer(event({ direction: 'front' })); states.push(clone(p.draft));
  for (let i = states.length - 2; i >= 0; i--) { p.undo(); assert.deepEqual(p.draft, states[i]); assert.deepEqual(store.board(date), states[i]); }
  assert.equal(p.data.canUndo, false); assert.equal(p.data.canRedo, true);
  for (let i = 1; i < states.length; i++) { p.redo(); assert.deepEqual(p.draft, states[i]); }
  assert.equal(p.data.canRedo, false); assert.deepEqual(createStore(storage).board(date), states.at(-1));
  assert.ok(p.cancelledGestures > 0); assert.equal(p.data.saveState, '已保存');
});
test('unchanged operations and selection are not undo steps; branching drops redo', t => {
  const { page: p, store, second } = fixture(t), revision = store.get().revision;
  p.color(event({ value: p.draft.color })); p.layer(event({ direction: 'back' }));
  p.texture(event({ value: 'fine' })); p.texture(event({ value: 'invalid' })); p.color(event({ value: 'invalid' }));
  p.select({ detail: { id: second } }); p.layer(event({ direction: 'front' }));
  assert.equal(store.get().revision, revision); assert.equal(p.data.canUndo, false);
  p.transform({ detail: { op: 'cw' } }); p.undo(); assert.equal(p.data.canRedo, true);
  p.transform({ detail: { op: 'up' } }); assert.equal(p.data.canRedo, false);
});
test('failed undo keeps saved snapshot, recoverable draft and retry/redo history', t => {
  const f = fixture(t), p = f.page, initial = clone(p.draft);
  p.transform({ detail: { op: 'cw' } }); const rotated = clone(p.draft);
  f.fail(true); p.undo();
  assert.equal(p.dirty, true); assert.match(p.data.saveError, /空间不足/);
  assert.deepEqual(f.store.board(f.date), rotated); assert.deepEqual(f.store.getDraft(f.date), initial);
  assert.equal(p.data.canRedo, true);
  f.fail(false); p.retrySave(); assert.equal(p.dirty, false); assert.deepEqual(f.store.board(f.date), initial);
  p.redo(); assert.deepEqual(f.store.board(f.date), rotated);
});
test('a failed edit can be undone back to last saved content without losing redo', t => {
  const f = fixture(t), p = f.page, initial = clone(p.draft);
  f.fail(true); p.transform({ detail: { op: 'cw' } }); assert.equal(p.data.canUndo, true);
  f.fail(false); p.undo(); assert.deepEqual(f.store.board(f.date), initial); assert.equal(p.data.canRedo, true); assert.equal(f.store.getDraft(f.date), undefined);
});
test('add/unplace reset history, retain memory, and external deletion cannot resurrect a memory', async t => {
  const { page: p, store, date, first } = fixture(t);
  p.transform({ detail: { op: 'cw' } });
  const added = store.add('new', date, photos('new')); p.photoDone(added);
  assert.equal(p.data.canUndo, false);
  p.transform({ detail: { op: 'cw' } }); await p.remove(); p.undo();
  assert.equal(p.data.canUndo, false); assert.ok(store.get().memories[added]); assert.equal(store.board(date).placements.some(p => p.memoryId === added), false);
  p.select({ detail: { id: first } }); p.transform({ detail: { op: 'cw' } }); store.remove(first); p.refresh(); p.undo();
  assert.equal(p.data.canUndo, false); assert.equal(store.get().memories[first], undefined);
});
test('returning from detail preserves layout history without reverting edited text or replacement photos', t => {
  const { page: p, store, first } = fixture(t);
  p.transform({ detail: { op: 'cw' } });
  store.edit(first, '新的文字', '饮食'); store.replace('replace', first, photos('new-photo')); p.refresh();
  assert.equal(p.data.canUndo, true); p.undo();
  assert.equal(store.get().memories[first].text, '新的文字'); assert.equal(store.get().memories[first].subjectPath, '/new-photo.png');
  assert.equal(p.data.model.items.find(i => i.memoryId === first).memory.subjectPath, '/new-photo.png');
});
test('photo processing and draft recovery block layout actions; finishing starts a fresh session', t => {
  const { page: p, store } = fixture(t);
  p.transform({ detail: { op: 'cw' } }); const saved = clone(p.draft), revision = store.get().revision;
  for (const phase of ['photo', 'recover']) {
    p.photoTask = phase === 'photo' ? {} : null; p.data.recovering = phase === 'recover';
    p.undo(); p.layer(event({ direction: 'front' })); p.color(event({ value: config.colors[1].value })); p.texture(event({ value: 'long' })); p.done();
    assert.deepEqual(p.draft, saved); assert.equal(store.get().revision, revision); assert.equal(p.data.editable, true);
  }
  p.photoTask = null; p.data.recovering = false; p.done();
  assert.equal(p.data.editable, false); assert.equal(p.data.canUndo, false);
  p.edit(); assert.equal(p.data.editable, true); assert.equal(p.data.canUndo, false);
});

test('failed texture save can recover its draft and undo to the saved appearance', async t => {
  const f = fixture(t), p = f.page, original = clone(p.draft);
  f.fail(true); p.texture(event({ value: 'cross' }));
  assert.equal(p.data.saveState, '保存失败，请重试'); assert.equal(p.data.model.texture, 'cross'); assert.equal(f.store.board(f.date).texture, 'fine');
  assert.equal(f.store.getDraft(f.date).texture, 'cross');
  f.fail(false); p.dirty = false; p.refresh(); platform.call = async () => ({ confirm: true }); await p.recoverDraft();
  assert.equal(f.store.board(f.date).texture, 'cross'); assert.equal(p.data.appearanceLabel, '燕麦米 · 交织');
  p.undo(); assert.deepEqual(f.store.board(f.date), original); assert.equal(p.data.appearanceLabel, '燕麦米 · 细绒');
  p.redo(); assert.equal(f.store.board(f.date).texture, 'cross');
});
test('recovering a failed draft is undoable and can save the restored previous layout', async t => {
  const { page: p, store, date } = fixture(t), initial = clone(p.draft), draft = clone(p.draft);
  draft.color = config.colors[1].value; store.keepDraft(draft);
  platform.call = async () => ({ confirm: true }); await p.recoverDraft();
  assert.equal(p.data.recovering, false); assert.equal(p.data.canUndo, true); assert.equal(store.board(date).color, config.colors[1].value);
  p.undo(); assert.deepEqual(store.board(date), initial);
});

test('long press starts editing and switches selection without saving or clearing undo history', t => {
  const { page: p, store, first, second } = fixture(t);
  p.done(); const revision = store.get().revision;
  p.editItem({ detail: { id: first } });
  assert.equal(p.data.editable, true); assert.equal(p.data.selected, first); assert.equal(p.data.memoryCardId, ''); assert.equal(store.get().revision, revision);
  p.transform({ detail: { op: 'cw' } });
  p.editItem({ detail: { id: second } }); assert.equal(p.data.selected, second); assert.equal(p.data.canUndo, true);
  p.undo(); assert.equal(store.board(p.date).placements.find(i => i.memoryId === first).angle, 0);
});

test('long press cannot enter editing through an overlay, busy state, missing object or read-only date', t => {
  const { page: p, first, store } = fixture(t); p.done(); const before = clone(store.get());
  for (const key of ['loading', 'error', 'drawer', 'formOpen', 'editorOpen', 'memoryCardId', 'task', 'placing', 'recovering', 'openingLibrary', 'working']) {
    const previous = p.data[key]; p.data[key] = true; p.editItem({ detail: { id: first } }); p.data[key] = previous;
    assert.equal(p.data.editable, false, key); assert.equal(p.data.selected, '');
  }
  p.editItem({ detail: { id: 'missing' } }); assert.equal(p.data.editable, false);
  p.date = '2020-01-01'; p.editItem({ detail: { id: first } }); assert.equal(p.data.editable, false);
  assert.deepEqual(store.get(), before);
});
