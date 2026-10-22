const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, KEY, validate, clone } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
const { query } = require('../miniprogram/core/memory-query');
function fixture() {
  const disk = {}; let fail = false;
  const storage = { get: key => disk[key], set: (key, value) => { if (fail && key === KEY) throw new Error('quota exceeded'); disk[key] = value; } };
  const store = createStore(storage), date = dates.key();
  const add = (id, day = date) => store.add(id, day, { originalPath: `/o-${id}.jpg`, subjectPath: `/s-${id}.png`, width: 300, height: 400, kind: 'extracted' });
  return { disk, store, storage, date, add, fail(value) { fail = value; } };
}

test('multi-add rejects an invalid member, capacity overflow or write failure without partial placement', () => {
  const f = fixture(), ids = [f.add('multi_a'), f.add('multi_b')], theme = f.store.createTheme('multi', '收藏');
  let before = f.disk[KEY];
  assert.throws(() => f.store.placeMany([...ids, 'missing'], theme), /已被删除/); assert.equal(f.disk[KEY], before);
  f.fail(true); assert.throws(() => f.store.placeMany(ids, theme), /quota/); assert.equal(f.disk[KEY], before); f.fail(false);
  for (let i = 0; i < config.maxItems - 1; i++) f.store.add('filled_' + i, f.date, { originalPath: '/o', subjectPath: '/s', width: 100, height: 100 }, theme);
  before = f.disk[KEY]; assert.throws(() => f.store.placeMany(ids, theme), /最多/); assert.equal(f.disk[KEY], before);
  const daily = f.store.board(f.date), revision = f.store.get().revision;
  f.store.placeMany([ids[0], ids[0]], theme); assert.equal(f.store.board(theme).placements.length, config.maxItems);
  assert.equal(f.store.get().revision, revision + 1); assert.deepEqual(f.store.board(f.date), daily);
});
test('v1 upgrade is read-only, preserves geometry/photos and is written atomically on first mutation', () => {
  const f = fixture(), id = f.add('legacy'); const legacy = f.store.get(); legacy.version = 1; delete legacy.boards[f.date].membershipRevision;
  f.disk[KEY] = JSON.stringify(legacy); const raw = f.disk[KEY], store = createStore(f.storage);
  assert.equal(store.load().version, 2); assert.equal(f.disk[KEY], raw); assert.deepEqual(store.get().memories[id], legacy.memories[id]);
  assert.deepEqual(store.board(f.date).placements, legacy.boards[f.date].placements);
  f.fail(true); assert.throws(() => store.createTheme('first', '旅行'), /quota/); assert.equal(f.disk[KEY], raw); assert.equal(store.get().boards.theme_first, undefined);
  f.fail(false); store.createTheme('first', '旅行'); assert.equal(JSON.parse(f.disk[KEY]).version, 2); assert.deepEqual(createStore(f.storage).get().memories[id], legacy.memories[id]);
});
test('damaged v1 or unknown schema is rejected without being repaired into a valid orphan', () => {
  const f = fixture(); f.add('legacy'); const state = f.store.get(); state.version = 1; state.boards[f.date].placements = [];
  for (const version of [1, 99]) { state.version = version; f.disk[KEY] = JSON.stringify(state); const raw = f.disk[KEY]; assert.throws(() => createStore(f.storage).load()); assert.equal(f.disk[KEY], raw); }
});
test('a shared memory has independent layouts and edits/crops update the single shared source', () => {
  const f = fixture(), id = f.add('shared'), a = f.store.createTheme('a', '秋天', id), b = f.store.createTheme('b', '散步');
  f.store.place(id, b); const daily = f.store.board(f.date), other = f.store.board(b), changed = f.store.board(a);
  changed.placements[0].x += 100; changed.placements[0].angle = 15; changed.color = config.colors[4].value; f.store.saveBoard(changed);
  assert.deepEqual(f.store.board(f.date), daily); assert.deepEqual(f.store.board(b), other); assert.equal(Object.keys(f.store.get().memories).length, 1);
  f.store.edit(id, '共用文字', '自然'); const original = f.store.get().memories[id];
  f.store.editSubject('crop', id, original, { subjectPath: '/cropped.png', width: 250, height: 300, kind: 'extracted' });
  for (const key of [f.date, a, b]) { const item = f.store.view(key).items[0]; assert.equal(item.memory.text, '共用文字'); assert.equal(item.memory.subjectPath, '/cropped.png'); }
  assert.deepEqual(f.store.board(a).placements, changed.placements); assert.equal(f.store.boardsForMemory(id).length, 3);
});
test('unplacing the last reference retains memory, files and library discovery, and can restore the daily board', () => {
  const f = fixture(), id = f.add('only', '2024-02-29'); f.store.unplace(id, '2024-02-29');
  assert.equal(f.store.boardsForMemory(id).length, 0); assert.equal(query(f.store.get()).total, 1); assert.equal(f.store.get().garbage.length, 0);
  assert.equal(f.store.referenced('/s-only.png'), true); assert.equal(f.store.canEdit('2024-02-29'), true);
  const restarted = createStore(f.storage); restarted.place(id, '2024-02-29'); assert.equal(restarted.view('2024-02-29').items[0].memoryId, id);
  assert.throws(() => restarted.place(id, f.date), /当天/); assert.equal(restarted.get().memories[id].date, '2024-02-29');
});
test('duplicate placement is a no-op; unsaved target layout and full boards reject atomically', () => {
  const f = fixture(), id = f.add('one'), theme = f.store.createTheme('full', '收藏', id), raw = f.disk[KEY];
  f.store.place(id, theme); assert.equal(f.disk[KEY], raw);
  const other = f.add('other', '2024-02-29'); f.store.keepDraft(f.store.board(theme)); assert.throws(() => f.store.place(other, theme), /未保存/); f.store.clearDraft(theme);
  for (let i = 1; i < config.maxItems; i++) f.store.place(f.add(`item${i}`), theme);
  const before = f.disk[KEY]; assert.throws(() => f.store.place(other, theme), /最多/); assert.equal(f.disk[KEY], before);
});
test('failed placement/removal/deletion/name changes preserve the full original snapshot', () => {
  const f = fixture(), id = f.add('one'), theme = f.store.createTheme('safe', '安全'); const before = f.disk[KEY];
  f.fail(true);
  for (const action of [() => f.store.place(id, theme), () => f.store.unplace(id, f.date), () => f.store.remove(id), () => f.store.renameTheme(theme, '新名称'), () => f.store.deleteTheme(theme)]) {
    assert.throws(action, /quota/); assert.equal(f.disk[KEY], before); assert.deepEqual(f.store.get(), JSON.parse(before));
  }
});
test('global deletion removes all placements and relevant drafts before files are eligible for collection', () => {
  const f = fixture(), id = f.add('one'), other = f.add('two'), a = f.store.createTheme('a', 'A', id), b = f.store.createTheme('b', 'B', id);
  f.store.place(other, b); const otherPlacement = f.store.board(b).placements[1];
  [f.date, a, b].forEach(key => f.store.keepDraft(f.store.board(key))); f.store.keepMemoryDraft(id, { text: 'draft', category: 0 });
  f.store.remove(id); assert.equal(f.store.get().memories[id], undefined); assert.equal(f.store.referenced('/o-one.jpg'), false); assert.deepEqual(f.store.get().garbage, ['/o-one.jpg', '/s-one.png']);
  for (const key of [f.date, a, b]) { assert.ok(!f.store.board(key).placements.some(p => p.memoryId === id)); assert.equal(f.store.getDraft(key), undefined); }
  assert.equal(f.store.getMemoryDraft(id), undefined); assert.deepEqual(f.store.board(b).placements[0], otherPlacement);
});
test('deleting a theme keeps all memories and other boards and cannot be undone by stale layout saves', () => {
  const f = fixture(), id = f.add('one'), a = f.store.createTheme('a', 'A', id), b = f.store.createTheme('b', 'B', id), old = f.store.board(a), daily = f.store.board(f.date);
  f.store.keepDraft(old); f.store.deleteTheme(a); assert.equal(f.store.getDraft(a), undefined); assert.throws(() => f.store.saveBoard(old), /不存在/);
  assert.equal(f.store.get().garbage.length, 0); assert.equal(f.store.boardsForMemory(id).length, 2); assert.deepEqual(f.store.board(f.date), daily); assert.equal(f.store.view(b).items.length, 1);
  assert.throws(() => f.store.deleteTheme(f.date), /只能删除/);
});
test('unplace then re-add invalidates old drafts even when memory IDs are identical; rename survives an old layout save', () => {
  const f = fixture(), id = f.add('one'), theme = f.store.createTheme('a', '旧名称', id), stale = f.store.board(theme);
  f.store.unplace(id, theme); f.store.place(id, theme); assert.throws(() => f.store.saveBoard(stale), /记忆已变化/);
  const layout = f.store.board(theme); f.store.renameTheme(theme, '新名称'); layout.color = config.colors[2].value; f.store.saveBoard(layout);
  assert.equal(f.store.board(theme).title, '新名称'); assert.equal(f.store.board(theme).color, config.colors[2].value);
});
test('theme creation validates names, limits and references, and create-with-memory is atomic', () => {
  const f = fixture(), id = f.add('one'), before = f.disk[KEY];
  for (const title of ['', '  ', '字'.repeat(config.maxBoardTitle + 1)]) assert.throws(() => f.store.createTheme('invalid', title), /名称/);
  assert.throws(() => f.store.createTheme('missing', '新板', 'missing'), /已被删除/); assert.equal(f.disk[KEY], before);
  const theme = f.store.createTheme('one', '  合集  ', id); assert.equal(f.store.board(theme).title, '合集'); const raw = f.disk[KEY];
  assert.equal(f.store.createTheme('one', '合集', id), theme); assert.equal(f.disk[KEY], raw);
  for (let i = 1; i < config.maxThemes; i++) f.store.createTheme(`limit${i}`, `${i}`);
  assert.throws(() => f.store.createTheme('overflow', '满了'), /最多/);
  const corrupt = clone(f.store.get()); corrupt.boards[theme].placements.push(clone(corrupt.boards[theme].placements[0])); assert.throws(() => validate(corrupt), /关系异常/);
});
