const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, KEY, clone, validate } = require('../miniprogram/core/store');
const libraries = require('../miniprogram/core/memory-libraries');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
function fixture() {
  const disk = {}; let fail = false;
  const storage = { get: key => disk[key], set(key, value) { if (fail && key === KEY) throw Error('disk full'); disk[key] = value; } };
  const store = createStore(storage), date = dates.key();
  const id = store.add('keepsake', date, { originalPath: '/original.jpg', subjectPath: '/subject.png', width: 200, height: 200 }, date, { deferPlacement: true });
  return { disk, storage, store, id, date, fail(value) { fail = value; } };
}
test('one stored photo can join several independent libraries without placing, copying or rewriting it', () => {
  const f = fixture(), a = f.store.createLibrary('a', '旅途拾光'), b = f.store.createLibrary('b', '小物');
  const memory = f.store.get().memories[f.id], boards = f.store.get().boards;
  f.store.setMemoryLibraries(f.id, [a, a, b]);
  assert.deepEqual(libraries.forMemory(f.store.get(), f.id).map(item => item.id).sort(), [a, b]);
  assert.equal(libraries.list(f.store.get()).reduce((n, item) => n + item.count, 0), 2);
  assert.deepEqual(f.store.get().boards, boards); assert.deepEqual(f.store.get().memories[f.id], memory);
  const before = f.disk[KEY]; f.store.setMemoryLibraries(f.id, [b, a]); assert.equal(f.disk[KEY], before);
  assert.deepEqual(createStore(f.storage).get(), f.store.get());
});
test('library save failures, missing libraries and missing objects never leave a partial membership change', () => {
  const f = fixture(), a = f.store.createLibrary('a', '第一本'), b = f.store.createLibrary('b', '第二本');
  f.store.setMemoryLibraries(f.id, [a]); const before = f.disk[KEY], state = f.store.get();
  f.fail(true); assert.throws(() => f.store.setMemoryLibraries(f.id, [b]), /disk full/);
  assert.equal(f.disk[KEY], before); assert.deepEqual(f.store.get(), state);
  f.fail(false); assert.throws(() => f.store.setMemoryLibraries(f.id, [b, 'library_missing']), /已被删除/);
  assert.throws(() => f.store.setMemoryLibraries('missing', [b]), /已被删除/); assert.equal(f.disk[KEY], before);
});
test('renaming/deleting libraries preserves photos, notes, board geometry and other memberships', () => {
  const f = fixture(), a = f.store.createLibrary('a', '旧名字'), b = f.store.createLibrary('b', '保留');
  f.store.place(f.id, f.date); f.store.createTheme('theme', '主题板', f.id); f.store.edit(f.id, '留下的文字', '日常');
  f.store.setMemoryLibraries(f.id, [a, b]); const before = f.store.get();
  f.store.renameLibrary(a, '新名字'); assert.equal(f.store.createLibrary('a', '重试名称'), a);
  f.store.deleteLibrary(a); const after = f.store.get();
  assert.deepEqual(after.memories, before.memories); assert.deepEqual(after.boards, before.boards); assert.deepEqual(after.garbage, before.garbage);
  assert.deepEqual(libraries.forMemory(after, f.id).map(item => item.id), [b]);
  f.store.setMemoryLibraries(f.id, []); assert.equal(libraries.members(f.store.get(), libraries.ALL).length, 1);
});
test('replacing a photo retains its libraries; deleting it clears memberships while unplacing does not', () => {
  const f = fixture(), a = f.store.createLibrary('a', '随手记'); f.store.setMemoryLibraries(f.id, [a]); f.store.place(f.id, f.date);
  f.store.replace('replacement', f.id, { originalPath: '/new.jpg', subjectPath: '/new.png', width: 300, height: 400 });
  assert.equal(libraries.list(f.store.get())[0].images[0].path, '/new.png');
  f.store.unplace(f.id, f.date); assert.equal(libraries.list(f.store.get())[0].count, 1);
  f.store.remove(f.id); assert.deepEqual(f.store.get().libraries[a].memoryIds, []); assert.equal(libraries.list(f.store.get())[0].count, 0);
});
test('old snapshots read without writes; old-client dangling photo references are omitted from library counts', () => {
  const f = fixture(), old = f.store.get(); delete old.libraries; f.disk[KEY] = JSON.stringify(old); const before = f.disk[KEY];
  const store = createStore(f.storage); assert.deepEqual(libraries.list(store.get()), []); assert.equal(libraries.members(store.get(), 'all').length, 1); assert.equal(f.disk[KEY], before);
  const id = store.createLibrary('new', '新收藏'); store.setMemoryLibraries(f.id, [id]);
  const legacy = store.get(); delete legacy.memories[f.id]; f.disk[KEY] = JSON.stringify(legacy);
  const reread = createStore(f.storage).get(); assert.equal(libraries.list(reread)[0].count, 0); assert.equal(libraries.members(reread, 'all').length, 0);
});
test('library names, bounds and duplicate or malformed membership data are validated', () => {
  const f = fixture(), id = f.store.createLibrary('one', '  小小收藏  ');
  assert.equal(f.store.get().libraries[id].title, '小小收藏');
  for (const name of ['', ' ', '字'.repeat(config.maxLibraryTitle + 1), '小小收藏']) assert.throws(() => f.store.createLibrary('bad', name), /名称|同名/);
  const original = f.store.get();
  for (const memoryIds of [[f.id, f.id], [null], 'bad']) { const bad = clone(original); bad.libraries[id].memoryIds = memoryIds; assert.throws(() => validate(bad), /记忆库/); }
  f.store.setMemoryLibraries(f.id, [id]); const a = libraries.list(f.store.get()); a[0].images[0].path = 'mutated'; assert.equal(f.store.get().memories[f.id].subjectPath, '/subject.png');
});
