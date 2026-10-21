const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const platform = require('../miniprogram/services/platform');
const dates = require('../miniprogram/core/date');
let definition;
global.Component = value => { definition = value; }; require('../miniprogram/components/memory-card/index'); delete global.Component;
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = platform.unloadGuard, originalToast = platform.toast; t.after(() => { platform.unloadGuard = original; platform.toast = originalToast; });
  const disk = {}, guards = [], events = []; let fail = false;
  platform.unloadGuard = value => guards.push(value);
  platform.toast = () => {};
  const store = createStore({ get: key => disk[key], set(key, value) { if (fail && key === KEY) throw new Error('disk full'); disk[key] = value; } });
  const id = store.add('card', dates.key(), { originalPath: '/original.jpg', subjectPath: '/subject.png', width: 400, height: 300, category: '自然', categorySource: 'auto' });
  store.createTheme('card_theme', '春天', id);
  function mount() {
    const card = { ...definition.methods, store, data: { ...clone(definition.data), memoryId: id },
      setData(value, done) { Object.assign(this.data, value); if (done) done(); }, triggerEvent(name, detail) { events.push({ name, detail }); } };
    card.refresh(); return card;
  }
  return { store, id, disk, guards, events, mount, settle() { t.mock.timers.tick(230); t.mock.timers.tick(230); }, fail(value) { fail = value; } };
}
const input = value => ({ detail: { value } });

test('rapid taps cannot edit mid-turn; the editor can regain focus after blur, cancel and save', t => {
  const f = fixture(t), c = f.mount();
  c.flip(); c.flip(); c.edit(); assert.equal(c.data.editing, false);
  f.settle(); assert.equal(c.data.flipped, true); c.edit(); assert.equal(c.data.noteFocus, true);
  c.noteBlurred(); assert.equal(c.data.noteFocus, false);
  c.noteFocused(); assert.equal(c.data.noteFocus, true);
  c.cancelEdit(); assert.equal(c.data.noteFocus, false);
  c.edit(); assert.equal(c.data.noteFocus, true); c.input(input('重新编辑仍然可以输入')); c.save();
  assert.equal(c.data.noteFocus, false); assert.equal(f.store.get().memories[f.id].text, '重新编辑仍然可以输入');
});

test('each opening randomly selects one material without journal writes, and keeps it while editing or refreshing', t => {
  const f = fixture(t), raw = f.disk[KEY], random = Math.random;
  t.after(() => { Math.random = random; });
  for (const [value, expected] of [[0, 'cotton'], [.34, 'polaroid'], [.999, 'ticket']]) {
    Math.random = () => value;
    const c = f.mount();
    assert.equal(c.data.cardStyle, expected);
    assert.equal(f.disk[KEY], raw, 'presentation does not modify the memory or board');
    Math.random = () => { throw new Error('must not reroll an open card'); };
    c.flip(); f.settle(); c.edit(); c.refresh(); c.cancelEdit(); c.openThemes(); c.closeThemes(); c.save();
    assert.equal(c.data.cardStyle, expected);
  }
});

test('front caption reflects the first saved nonblank line and preserves complete back text', t => {
  const f = fixture(t), c = f.mount();
  assert.equal(c.data.frontCaption, '把平凡的一刻，轻轻收好');
  assert.equal(c.data.cardDate, f.store.get().memories[f.id].date.replace(/-/g, '.'));
  c.edit(); c.input(input(' \n窗边的绿意\n今天也很美好')); c.save();
  assert.equal(c.data.frontCaption, '窗边的绿意');
  assert.equal(c.data.memory.text, ' \n窗边的绿意\n今天也很美好');
  c.edit(); c.input(input('尚未保存的文字')); c.cancelEdit();
  assert.equal(c.data.frontCaption, '窗边的绿意');
  c.edit(); c.input(input('')); c.save();
  assert.equal(c.data.frontCaption, '把平凡的一刻，轻轻收好');
});

test('opening and flipping an uncaptioned image writes nothing; text can be added, edited and cleared', t => {
  const f = fixture(t), raw = f.disk[KEY], c = f.mount();
  assert.equal(c.data.flipped, false); c.flip(); f.settle(); assert.equal(c.data.flipped, true);
  assert.equal(c.data.memory.text, ''); c.flip(); f.settle(); assert.equal(f.disk[KEY], raw);
  const boards = clone(f.store.get().boards);
  c.edit(); c.flip(); assert.equal(c.data.flipped, true, 'typing must not flip the card');
  c.input(input('窗边的绿意\n今天也很美好')); assert.equal(c.save(), true);
  assert.equal(c.data.editing, false); assert.equal(f.mount().data.memory.text, '窗边的绿意\n今天也很美好');
  c.edit(); c.input(input('修改后的说明')); c.save(); assert.equal(f.store.get().memories[f.id].text, '修改后的说明');
  assert.equal(f.store.get().memories[f.id].categorySource, 'auto'); assert.deepEqual(f.store.get().boards, boards);
  c.edit(); c.input(input('')); c.save(); assert.equal(f.mount().data.memory.text, ''); assert.equal(f.store.getMemoryDraft(f.id), undefined);
});

test('save failure keeps a recoverable draft and blocks close until retry succeeds', t => {
  const f = fixture(t), c = f.mount(); c.edit(); c.input(input('保存失败也不能丢失'));
  f.fail(true); assert.equal(c.save(), false); c.close();
  assert.equal(c.data.editing, true); assert.ok(c.data.error); assert.equal(f.store.get().memories[f.id].text, '');
  assert.equal(f.events.length, 0); assert.equal(f.store.getMemoryDraft(f.id).text, '保存失败也不能丢失');
  const restored = f.mount(); assert.equal(restored.data.flipped, true); assert.equal(restored.data.editing, true);
  assert.equal(restored.data.text, '保存失败也不能丢失'); assert.equal(f.guards.at(-1), true);
  f.fail(false); restored.close(); assert.equal(f.events.at(-1).name, 'close'); assert.equal(f.store.getMemoryDraft(f.id), undefined);
  assert.equal(f.store.get().memories[f.id].text, '保存失败也不能丢失'); assert.equal(f.guards.at(-1), false);
});

test('cancel discards only the current text draft and external edits refresh; deleted records can close', t => {
  const f = fixture(t), c = f.mount(); f.store.edit(f.id, '已保存', '自然'); c.refresh();
  c.edit(); c.input(input('不保留')); c.cancelEdit(); assert.equal(c.data.text, '已保存'); assert.equal(f.store.getMemoryDraft(f.id), undefined);
  c.edit(); c.input(input('关闭卡片前保存')); c.close(); assert.equal(f.events.at(-1).name, 'close'); assert.equal(f.store.get().memories[f.id].text, '关闭卡片前保存');
  c.input(input('另一个草稿')); f.store.remove(f.id); c.refresh(); assert.equal(c.data.memory, null);
  c.close(); assert.equal(f.events.at(-1).name, 'close');
});

const themeEvent = id => ({ currentTarget: { dataset: { id } } });
test('back-of-card theme picker adds a shared memory in place and marks duplicates without changing source layouts', t => {
  const f = fixture(t), c = f.mount(), daily = clone(f.store.board(dates.key()));
  const target = f.store.createTheme('target', '另一块板'), originalMemory = clone(f.store.get().memories[f.id]);
  c.openThemes(); assert.equal(c.data.themeOpen, false);
  c.flip(); f.settle(); c.openThemes(); assert.equal(c.data.themeOpen, true);
  assert.equal(c.data.themes.find(board => board.id === 'theme_card_theme').placed, true);
  c.flip(); assert.equal(c.data.flipped, true, 'theme selection must not flip or dismiss the card');
  c.placeTheme(themeEvent(target)); c.placeTheme(themeEvent(target));
  assert.equal(c.data.themeOpen, false); assert.equal(c.data.flipped, true);
  assert.equal(f.store.board(target).placements.length, 1); assert.deepEqual(f.store.board(dates.key()), daily);
  assert.deepEqual(f.store.get().memories[f.id], originalMemory); assert.equal(f.events.length, 1); assert.equal(f.events[0].name, 'change');
  c.openThemes(); assert.equal(c.data.themes.find(board => board.id === target).placed, true);
});

test('theme placement failure preserves card and selection; retry commits once and unsaved target layouts are protected', t => {
  const f = fixture(t), c = f.mount(), target = f.store.createTheme('target', '另一块板');
  c.flip(); f.settle(); c.openThemes(); const raw = f.disk[KEY];
  f.fail(true); c.placeTheme(themeEvent(target)); assert.equal(f.disk[KEY], raw); assert.equal(c.data.themeOpen, true); assert.ok(c.data.themeError); assert.equal(f.events.length, 0);
  f.fail(false); f.store.keepDraft(f.store.board(target)); c.placeTheme(themeEvent(target)); assert.match(c.data.themeError, /未保存/); assert.equal(f.store.board(target).placements.length, 0);
  f.store.clearDraft(target); c.placeTheme(themeEvent(target)); assert.equal(f.store.board(target).placements.length, 1); assert.equal(c.data.themeOpen, false);
});

test('card can create a theme and place atomically, preserving its name on failure and avoiding duplicate retries', t => {
  const f = fixture(t), c = f.mount(); f.store.deleteTheme('theme_card_theme');
  c.flip(); f.settle(); c.openThemes(); assert.equal(c.data.themes.length, 0); c.createTheme();
  c.saveTheme(); assert.ok(c.data.themeError); assert.equal(c.data.themeCreating, true);
  c.themeInput(input('  旅行收藏  ')); const raw = f.disk[KEY]; f.fail(true); c.saveTheme();
  assert.equal(f.disk[KEY], raw); assert.equal(c.data.themeTitle, '  旅行收藏  '); assert.equal(c.data.themeCreating, true);
  f.fail(false); c.saveTheme(); c.saveTheme();
  const themes = Object.values(f.store.get().boards).filter(board => board.type === 'theme');
  assert.equal(themes.length, 1); assert.equal(themes[0].title, '旅行收藏'); assert.equal(themes[0].placements[0].memoryId, f.id);
  assert.equal(c.data.flipped, true); assert.equal(c.data.themeOpen, false); assert.equal(f.events.length, 1);
});

test('theme picker paginates and cancels without writes; deleted/full targets cannot lose or duplicate a photo', t => {
  const f = fixture(t), c = f.mount();
  for (let i = 0; i < 4; i++) f.store.createTheme('page_' + i, '主题 ' + i);
  c.flip(); f.settle(); const raw = f.disk[KEY]; c.openThemes(); assert.equal(c.data.themePageCount, 3); const seen = new Set();
  for (let i = 0; i < 3; i++) { c.data.visibleThemes.forEach(board => seen.add(board.id)); c.turnThemes({ currentTarget: { dataset: { offset: 1 } } }); }
  assert.equal(seen.size, 5); c.closeThemes(); assert.equal(f.disk[KEY], raw); assert.equal(c.data.flipped, true);
  c.openThemes(); f.store.deleteTheme('theme_page_0'); c.placeTheme(themeEvent('theme_page_0')); assert.match(c.data.themeError, /已被删除/); assert.equal(c.data.themeOpen, true);
  const full = 'theme_page_1';
  for (let i = 0; i < 30; i++) { const id = f.store.add('full_' + i, '2024-02-29', { originalPath: '/full.jpg', subjectPath: '/full.png', width: 50, height: 50 }); f.store.place(id, full); }
  c.refreshThemes(); assert.equal(c.data.themes.find(board => board.id === full).full, true);
  const fullRaw = f.disk[KEY]; c.placeTheme(themeEvent(full)); assert.equal(f.disk[KEY], fullRaw); assert.equal(c.data.themeOpen, true); assert.ok(c.data.themeError);
  f.store.remove(f.id); c.createTheme(); c.themeInput(input('不能创建空壳')); const deletedRaw = f.disk[KEY]; c.saveTheme(); assert.equal(f.disk[KEY], deletedRaw); assert.match(c.data.themeError, /已被删除/);
});

test('theme picker cannot interrupt note editing and saved captions remain shared after placement', t => {
  const f = fixture(t), c = f.mount(), target = f.store.createTheme('caption', '文字');
  c.flip(); f.settle(); c.edit(); c.input(input('记下这一刻')); c.openThemes(); assert.equal(c.data.themeOpen, false);
  c.save(); c.openThemes(); c.placeTheme(themeEvent(target));
  assert.equal(f.store.view(target).items[0].memory.text, '记下这一刻'); assert.equal(f.store.getMemoryDraft(f.id), undefined);
});
