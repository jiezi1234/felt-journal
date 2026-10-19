const test = require('node:test');
const assert = require('node:assert/strict');
const { createThemeBoardPage } = require('../miniprogram/services/theme-board-page');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const platform = require('../miniprogram/services/platform');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
const event = id => ({ currentTarget: { dataset: { id } } });

function fixture(t) {
  const original = { ...platform }, originalWx = global.wx;
  t.after(() => { Object.assign(platform, original); global.wx = originalWx; });
  const disk = {}, navigation = [], toasts = []; let failing = false;
  const store = createStore({ get: key => disk[key], set(key, value) { if (failing && key === KEY) throw new Error('quota exceeded'); disk[key] = value; } });
  const tab = { data: {}, setData(value) { Object.assign(this.data, value); } };
  platform.call = async (method, options) => { navigation.push({ method, options }); return { confirm: true }; };
  platform.unloadGuard = () => {}; platform.toast = message => toasts.push(message); platform.confirmRemovePlacement = async () => true;
  global.wx = { navigateTo: options => navigation.push({ method: 'navigateTo', options }) };
  const definition = createThemeBoardPage();
  const page = { ...definition, data: clone(definition.data), store, memoryId: '', getTabBar: () => tab, setData(value) { Object.assign(this.data, value); } };
  const add = (id, date = dates.key()) => store.add(id, date, { originalPath: '/photo.jpg', subjectPath: '/photo.png', width: 400, height: 300 });
  page.onShow();
  return { page, store, disk, navigation, tab, add, toasts, fail(value) { failing = value; } };
}
async function create(page, title = '主题') { page.create(); page.input({ detail: { value: title } }); await page.save(); return page.date; }

test('share modal keeps its theme selected, hides navigation and prevents switching or creating behind it', async t => {
  const f = fixture(t), p = f.page, memory = f.add('share');
  await create(p, '第一块'); const id = await create(p, '第二块');
  await p.library(); p.placeFromLibrary(event(memory));
  const before = f.disk[KEY], model = p.data.model;
  p.shareTheme(); assert.equal(p.data.shareBoardId, id); assert.equal(f.tab.data.hidden, true);
  p.turn(-1); p.create(); p.rename(); await p.removeTheme(); p.onShow();
  assert.equal(p.date, id); assert.equal(p.data.formOpen, false); assert.equal(p.data.model, model);
  p.closeShareCard(); assert.equal(f.tab.data.hidden, false); assert.equal(p.data.selected, memory);
  assert.equal(p.data.editable, true); assert.equal(f.disk[KEY], before); assert.deepEqual(f.navigation, []);
});

test('creating and completing a theme stays on the tab and starts arranging the new board', async t => {
  const f = fixture(t), p = f.page;
  assert.equal(p.data.model, null); assert.equal(Object.keys(f.store.get().boards).length, 0);
  p.create(); assert.equal(f.tab.data.hidden, true);
  p.input({ detail: { value: '旅途' } }); f.fail(true); await p.save();
  assert.equal(p.data.formOpen, true); assert.equal(p.data.model, null);
  f.fail(false); await p.save();
  assert.equal(p.data.formOpen, false); assert.equal(f.tab.data.hidden, false);
  assert.equal(p.data.model.title, '旅途'); assert.equal(p.data.editable, true);
  p.done(); assert.equal(p.data.editable, false); assert.equal(p.data.model.title, '旅途');
  assert.deepEqual(f.navigation, []);
});

test('theme memory drawer includes other dates, paginates, and places without changing daily layouts', async t => {
  const f = fixture(t), p = f.page, ids = [];
  for (let i = 0; i < 7; i++) ids.push(f.add('memory_' + i, i % 2 ? '2024-01-01' : dates.key()));
  const daily = f.store.board(dates.key()), past = f.store.board('2024-01-01');
  const theme = await create(p); await p.library();
  assert.equal(p.data.drawer, 'library'); assert.equal(f.tab.data.hidden, true);
  const seen = []; for (let i = 0; i < 3; i++) { seen.push(...p.data.visibleLibraryItems.map(m => m.id)); p.libraryNext(); }
  assert.equal(new Set(seen).size, 7);
  p.placeFromLibrary(event(ids[1])); assert.equal(p.data.selected, ids[1]); assert.equal(p.data.count, 1);
  assert.equal(p.data.drawer, ''); assert.equal(f.tab.data.hidden, false);
  assert.equal(f.store.board(theme).placements[0].memoryId, ids[1]);
  await p.library(); assert.equal(p.data.libraryItems.some(m => m.id === ids[1]), false);
  assert.deepEqual(f.store.board(dates.key()), daily); assert.deepEqual(f.store.board('2024-01-01'), past);
  assert.deepEqual(f.navigation, []);
});

test('arrangement undo and redo remain independent and switching boards resets history and selection', async t => {
  const f = fixture(t), p = f.page, memory = f.add('one');
  const first = await create(p, '第一块'); await p.library(); p.placeFromLibrary(event(memory));
  const daily = f.store.board(dates.key()), original = f.store.board(first).placements[0].angle;
  p.transform({ detail: { op: 'cw' } }); const rotated = f.store.board(first).placements[0].angle;
  assert.notEqual(rotated, original); p.undo(); assert.equal(f.store.board(first).placements[0].angle, original);
  p.redo(); assert.equal(f.store.board(first).placements[0].angle, rotated);
  const second = await create(p, '第二块'); assert.notEqual(first, second);
  assert.equal(p.data.canUndo, false); assert.equal(p.data.selected, '');
  p.open(event(first)); assert.equal(p.date, first); assert.equal(p.data.model.items[0].angle, rotated); assert.equal(p.data.canUndo, false);
  p.next(); assert.equal(p.data.model.id, p.data.visibleThemes[0].id);
  assert.deepEqual(f.store.board(dates.key()), daily); assert.deepEqual(f.navigation, []);
});

test('failed layout saves block switching and creating until retry succeeds', async t => {
  const f = fixture(t), p = f.page;
  await create(p, '第一块'); const active = await create(p, '第二块');
  const ids = p.data.themes.map(b => b.id), other = ids.find(id => id !== active);
  f.fail(true); p.color({ currentTarget: { dataset: { value: config.colors[1].value } } });
  assert.equal(p.dirty, true); p.open(event(other)); p.create();
  assert.equal(p.date, active); assert.equal(p.data.formOpen, false); assert.ok(p.data.saveError);
  f.fail(false); p.retrySave(); p.open(event(other)); assert.equal(p.date, other); assert.equal(p.data.saveError, '');
  assert.deepEqual(f.navigation, []);
});

test('memory cards stay over the active theme and hide navigation until closed', async t => {
  const f = fixture(t), p = f.page, id = f.add('text'); await create(p);
  await p.library(); p.placeFromLibrary(event(id)); p.memory({ detail: { id } });
  assert.equal(p.data.memoryCardId, id); assert.equal(p.data.drawer, ''); assert.equal(f.tab.data.hidden, true);
  p.create(); assert.equal(p.data.formOpen, false); assert.equal(p.data.memoryCardId, id);
  f.store.edit(id, '一段记忆', f.store.get().memories[id].category); p.memoryCardChanged();
  assert.equal(p.data.model.items[0].memory.text, '一段记忆'); assert.equal(f.tab.data.hidden, true);
  p.closeMemoryCard(); assert.equal(p.data.memoryCardId, ''); assert.equal(f.tab.data.hidden, false);
  assert.equal(f.store.get().memories[id].text, '一段记忆'); assert.deepEqual(f.navigation, []);
});

test('renaming preserves the active theme and removing placements or themes preserves memories', async t => {
  const f = fixture(t), p = f.page, id = f.add('one'); const first = await create(p, '第一块');
  await p.library(); p.placeFromLibrary(event(id)); const second = await create(p, '第二块');
  p.open(event(first)); p.openSelection(); p.rename(); assert.equal(p.data.drawer, ''); assert.equal(p.data.formOpen, true);
  p.input({ detail: { value: '旅行收藏' } }); await p.save();
  assert.equal(p.date, first); assert.equal(p.data.model.title, '旅行收藏'); assert.equal(p.data.visibleThemes[0].id, first);
  p.select({ detail: { id } }); p.openSelection(); await p.remove();
  assert.equal(p.data.count, 0); assert.equal(p.data.drawer, ''); assert.equal(p.data.canUndo, false); assert.ok(f.store.get().memories[id]);
  p.openSelection(); await p.removeTheme(); assert.equal(p.date, second); assert.equal(p.data.model.title, '第二块');
  await p.removeTheme(); assert.equal(p.data.model, null); assert.equal(p.data.themes.length, 0);
  assert.ok(f.store.get().memories[id]); assert.equal(f.navigation.some(c => c.method === 'navigateTo'), false);
});

test('returning to the tab retains the selected board and keeps an open drawer above navigation', async t => {
  const f = fixture(t), p = f.page, first = await create(p, '第一块'); await create(p, '第二块');
  p.open(event(first)); p.openSelection(); p.onHide(); p.onShow();
  assert.equal(p.date, first); assert.equal(p.data.drawer, 'theme'); assert.equal(f.tab.data.hidden, true);
  p.closeDrawer(); assert.equal(f.tab.data.hidden, false); assert.deepEqual(f.navigation, []);
});
