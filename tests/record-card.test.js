const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoardEditor } = require('../miniprogram/services/board-editor');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const platform = require('../miniprogram/services/platform');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
let homeDefinition;
global.Page = value => { homeDefinition = value; };
require('../miniprogram/pages/index/index');
delete global.Page;
const event = value => ({ currentTarget: { dataset: value } });
const photos = id => ({ originalPath: `/${id}.jpg`, subjectPath: `/${id}.png`, width: 400, height: 300, kind: 'extracted' });
function fixture(t) {
  const originals = { ...platform }, originalWx = global.wx, originalKey = dates.key;
  t.after(() => { Object.assign(platform, originals); global.wx = originalWx; dates.key = originalKey; });
  const events = [], navigation = [], guards = [], disk = {}; let fail = false;
  const storage = { get: key => disk[key], set(key, value) { if (fail && key === KEY) throw new Error('disk full'); disk[key] = value; } };
  const store = createStore(storage), date = dates.key();
  platform.unloadGuard = enabled => guards.push(enabled); platform.toast = () => {};
  platform.back = () => navigation.push('back'); platform.call = async method => { navigation.push(method); return { confirm: true }; };
  global.wx = { navigateTo: value => navigation.push(value.url), switchTab: value => navigation.push(value.url) };
  const controller = createBoardEditor({ embedded: true });
  const page = Object.assign({}, controller, { data: clone(controller.data), store, date, wantEdit: true,
    setData(value) { Object.assign(this.data, value); }, triggerEvent(name) { events.push(name); },
    selectComponent() { return { touchCancel() {} }; } });
  page.refresh();
  return { page, store, storage, date, events, navigation, guards, fail(value) { fail = value; } };
}

test('opening and closing a record card does not navigate or create an empty daily board', async t => {
  const f = fixture(t), before = f.store.get();
  await f.page.sourceSheet(); assert.equal(f.page.data.sourceStage, true);
  await f.page.back(); assert.deepEqual(f.events, ['close']); assert.deepEqual(f.navigation, []);
  assert.deepEqual(f.store.get(), before);
  f.events.length = 0; f.page.showBoard(); f.page.done();
  assert.deepEqual(f.events, ['close']); assert.deepEqual(f.store.get(), before);
});

test('appearance stays collapsed until opened and saves only the selected daily board', async t => {
  const f = fixture(t), p = f.page;
  f.store.createTheme('fixed', '长期收藏'); const theme = f.store.board('theme_fixed');
  assert.equal(p.data.drawer, ''); p.openAppearance(); assert.equal(p.data.drawer, 'appearance');
  p.color(event({ value: config.colors[4].value })); p.texture(event({ value: 'long' }));
  await p.back(); assert.equal(p.data.drawer, ''); assert.deepEqual(f.events, []);
  assert.equal(f.store.board(f.date).texture, 'long'); assert.deepEqual(f.store.board('theme_fixed'), theme);
  p.undo(); assert.equal(f.store.board(f.date).texture, 'fine');
  await p.back(); assert.deepEqual(f.events, ['close']); assert.deepEqual(f.navigation, []);
});

test('inline note failure retains the draft and blocks closing until saved or explicitly discarded', async t => {
  const f = fixture(t), p = f.page, id = f.store.add('one', f.date, photos('one'));
  p.photoDone(id); p.memory({ detail: { id } }); assert.equal(p.data.drawer, 'note');
  p.noteInput({ detail: { value: '今天的一点小确幸' } }); p.noteCategoryInput({ detail: { value: '1' } });
  f.fail(true); await p.back();
  assert.equal(p.data.drawer, 'note'); assert.match(p.data.noteError, /空间不足/);
  assert.equal(f.store.get().memories[id].text, ''); assert.equal(f.events.includes('close'), false);
  assert.equal(f.store.getMemoryDraft(id).text, '今天的一点小确幸');
  f.fail(false); assert.equal(p.saveNote(), true);
  assert.equal(f.store.get().memories[id].category, config.categories[1]);
  assert.equal(f.store.get().memories[id].text, '今天的一点小确幸');
  assert.equal(f.store.getMemoryDraft(id), undefined); assert.equal(p.data.drawer, '');
  p.done(); assert.equal(f.events.at(-1), 'close'); assert.deepEqual(f.navigation, []);
});

test('reopening a memory restores its inline text draft; discarding preserves committed text', t => {
  const f = fixture(t), id = f.store.add('one', f.date, photos('one'));
  f.store.edit(id, '已保存的文字', config.categories[0]); f.page.photoDone(id);
  f.store.keepMemoryDraft(id, { text: '未保存的文字', category: 1 });
  f.page.openNote(id); assert.equal(f.page.data.noteText, '未保存的文字'); assert.equal(f.page.noteDirty, true);
  f.page.discardNote(); assert.equal(f.store.getMemoryDraft(id), undefined);
  assert.equal(f.store.get().memories[id].text, '已保存的文字');
});

test('in-card library restores an unplaced same-day photo without including other days', async t => {
  const f = fixture(t), id = f.store.add('one', f.date, photos('one'));
  f.store.unplace(id, f.date); const older = f.store.add('old', '2020-01-01', photos('old')); f.store.unplace(older, '2020-01-01');
  await f.page.library(); assert.deepEqual(f.page.data.libraryItems.map(m => m.id), [id]);
  f.page.placeFromLibrary(event({ id })); assert.equal(f.page.data.drawer, '');
  assert.equal(f.store.board(f.date).placements[0].memoryId, id); assert.deepEqual(f.navigation, []);
});

test('close confirmation is safe if photo processing finishes while the confirmation is open', async t => {
  const f = fixture(t), p = f.page; let finish, cancelCalls = 0;
  p.photoTask = { cancel: async () => { cancelCalls++; } };
  platform.call = () => new Promise(resolve => { finish = resolve; });
  const closing = p.back(); await p.back();
  const id = f.store.add('completed', f.date, photos('completed')); p.photoTask = null; p.photoDone(id);
  finish({ confirm: true }); await closing;
  assert.equal(cancelCalls, 0); assert.equal(f.events.filter(e => e === 'close').length, 1);
  assert.ok(f.store.get().memories[id]); assert.deepEqual(f.navigation, []);
});

test('canceling a processing card cancels its task exactly once; declining keeps it open', async t => {
  const f = fixture(t), p = f.page; let canceled = 0;
  p.photoTask = { cancel: async () => { canceled++; p.photoTask = null; } };
  platform.call = async () => ({ confirm: false }); await p.back(); assert.equal(canceled, 0); assert.deepEqual(f.events, []);
  platform.call = async () => ({ confirm: true }); await p.back(); assert.equal(canceled, 1); assert.deepEqual(f.events, ['close']);
});

test('home opens a component, hides navigation, and refreshes the day only after closing it', t => {
  const f = fixture(t), tabs = [];
  platform.syncTab = (page, active, hidden = false) => tabs.push({ active, hidden });
  const home = Object.assign({}, homeDefinition, { data: clone(homeDefinition.data), store: f.store, setData(value) { Object.assign(this.data, value); } });
  home.refresh(); home.primary(); assert.equal(home.data.editorOpen, true); assert.equal(home.data.startWithPhoto, true);
  assert.equal(home.data.editorDate, f.date); assert.deepEqual(f.navigation, []);
  dates.key = () => '2099-01-02'; home.primary(); assert.equal(home.data.editorDate, f.date);
  home.closeEditor(); assert.equal(home.data.date, '2099-01-02'); assert.equal(home.data.editorOpen, false);
  assert.deepEqual(tabs, [{ active: 'today', hidden: true }, { active: 'today', hidden: false }]);
  assert.equal(f.store.get().boards['2099-01-02'], undefined);
});

test('in-card library paginates all unplaced photos without touching saved data', async t => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) { const id = f.store.add('page_' + i, f.date, photos('page_' + i)); f.store.unplace(id, f.date); }
  const before = JSON.stringify(f.store.get()); await f.page.library(); const seen = [];
  for (let i = 0; i < 3; i++) { seen.push(...f.page.data.visibleLibraryItems.map(m => m.id)); f.page.libraryNext(); }
  assert.equal(new Set(seen).size, 8); assert.equal(f.page.data.libraryPage, 3); assert.equal(JSON.stringify(f.store.get()), before);
});
