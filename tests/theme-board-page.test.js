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

test('creation opens the memory picker and skipping it returns to browsing on the same board', async t => {
  const f = fixture(t), p = f.page;
  assert.equal(p.data.model, null); assert.equal(Object.keys(f.store.get().boards).length, 0);
  p.create(); assert.equal(f.tab.data.hidden, true);
  p.input({ detail: { value: '旅途' } }); f.fail(true); await p.save();
  assert.equal(p.data.formOpen, true); assert.equal(p.data.model, null);
  f.fail(false); await p.save();
  assert.equal(p.data.formOpen, false); assert.equal(f.tab.data.hidden, true);
  assert.equal(p.data.model.title, '旅途'); assert.equal(p.data.editable, false); assert.equal(p.data.drawer, 'library');
  p.closeDrawer(); assert.equal(p.data.editable, false); assert.equal(p.data.model.title, '旅途'); assert.equal(f.tab.data.hidden, false);
  assert.deepEqual(f.navigation, []);
});

test('theme memory picker filters across dates and preserves selections when changing filters', async t => {
  const f = fixture(t), p = f.page, ids = [];
  for (let i = 0; i < 7; i++) ids.push(f.add('memory_' + i, i % 2 ? '2024-01-01' : dates.key()));
  const daily = f.store.board(dates.key()), past = f.store.board('2024-01-01');
  const theme = await create(p); await p.library();
  assert.equal(p.data.drawer, 'library'); assert.equal(f.tab.data.hidden, true);
  assert.equal(p.data.visibleLibraryItems.length, 7);
  p.toggleLibrary(event(ids[1])); p.searchLibrary({ detail: { value: dates.key() } });
  assert.ok(p.data.visibleLibraryItems.every(m => m.date === dates.key()));
  p.toggleLibrary(event(ids[0])); p.searchLibrary({ detail: { value: '' } });
  assert.equal(p.data.visibleLibraryItems.filter(m => m.checked).length, 2);
  p.addLibrary(); assert.equal(p.data.selected, ids[0]); assert.equal(p.data.count, 2);
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
  p.openAppearance();
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
  p.editItem({ detail: { id } }); await p.remove();
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

test('title picker uses stable order and restores the last board after a new page instance', async t => {
  const f = fixture(t), p = f.page, first = await create(p, '第一块'); await create(p, '第二块');
  p.open(event(first)); assert.equal(p.data.editable, false);
  const order = p.data.themes.map(b => b.id);
  p.openThemePicker(); assert.equal(p.data.drawer, 'themes'); assert.equal(f.tab.data.hidden, true);
  p.closeDrawer(); p.rename(); p.input({ detail: { value: '旅行收藏' } }); await p.save();
  assert.deepEqual(p.data.themes.map(b => b.id), order);
  const definition = createThemeBoardPage();
  const next = { ...definition, data: clone(definition.data), store: f.store, setData(d) { Object.assign(this.data, d); } };
  next.onShow(); assert.equal(next.date, first); assert.equal(next.data.dateLabel, '旅行收藏');
  f.store.deleteTheme(first); next.refresh(); assert.notEqual(next.date, first); assert.equal(next.data.error, '');
});

test('failed multi-add keeps choices for retry and canceling a picker never enters arrangement', async t => {
  const f = fixture(t), p = f.page, ids = [f.add('a'), f.add('b')]; await create(p);
  ids.forEach(id => p.toggleLibrary(event(id))); const before = f.disk[KEY];
  f.fail(true); p.addLibrary();
  assert.equal(f.disk[KEY], before); assert.deepEqual(p.data.librarySelected, ids); assert.ok(p.data.libraryError);
  assert.equal(p.data.count, 0); assert.equal(p.data.drawer, 'library');
  f.fail(false); p.addLibrary(); assert.equal(p.data.count, 2); assert.equal(p.data.drawer, '');
  p.select({ detail: { id: '' } }); assert.equal(p.data.selected, ''); assert.equal(p.data.editable, false);
  await p.library(); p.closeDrawer(); assert.equal(p.data.editable, false);
  await p.sourceSheet(); p.closeDrawer(); assert.equal(p.data.editable, false);
});

test('swipes follow thumbnail order, retain the last board and stop at either end', async t => {
  const f = fixture(t), p = f.page;
  await create(p, '散步'); await create(p, '咖啡'); await create(p, '旅行'); p.closeDrawer();
  const ids = p.data.themes.map(b => b.id), before = f.disk[KEY];
  p.open(event(ids[0])); p.swipeBoard({ detail: { offset: -1 } }); assert.equal(p.date, ids[0]);
  for (const id of ids.slice(1)) { p.swipeBoard({ detail: { offset: 1 } }); assert.equal(p.date, id); assert.equal(f.store.activeTheme(), id); }
  p.swipeBoard({ detail: { offset: 1 } }); assert.equal(p.date, ids.at(-1));
  p.swipeBoard({ detail: { offset: -1 } }); assert.equal(p.date, ids[1]);
  p.swipeBoard({ detail: { offset: 2 } }); assert.equal(p.date, ids[1]);
  assert.equal(f.disk[KEY], before, 'Switching does not edit memories or layouts');
});

test('swipes cannot dismiss drawers or bypass unsaved-layout and overlay guards', async t => {
  const f = fixture(t), p = f.page;
  await create(p, '第一块'); await create(p, '第二块'); p.closeDrawer();
  p.open(event(p.data.themes[0].id)); const first = p.date, next = p.data.themes[1].id;
  for (const patch of [{ drawer: 'library' }, { dragging: true }, { formOpen: true }, { memoryCardId: 'card' }, { shareBoardId: first }, { working: true }, { task: { state: 'upload' } }]) {
    p.setData(patch); p.swipeBoard({ detail: { offset: 1 } }); assert.equal(p.date, first);
    Object.keys(patch).forEach(key => p.setData({ [key]: typeof patch[key] === 'boolean' ? false : '' }));
  }
  p.openAppearance(); f.fail(true); p.color({ currentTarget: { dataset: { value: config.colors[1].value } } });
  p.setData({ drawer: '' }); p.swipeBoard({ detail: { offset: 1 } }); assert.equal(p.date, first); assert.ok(p.data.saveError);
  f.fail(false); p.swipeBoard({ detail: { offset: 1 } }); assert.equal(p.date, next); assert.equal(p.data.selected, '');
});
