const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, KEY, clone } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const platform = require('../miniprogram/services/platform');
const photo = require('../miniprogram/services/page-photo');
let definition, home, memoryCard;
global.Component = value => { definition = value; }; require('../miniprogram/components/memory-library/index');
global.Component = value => { memoryCard = value; }; require('../miniprogram/components/memory-card/index'); delete global.Component;
global.Page = value => { home = value; }; require('../miniprogram/pages/index/index'); delete global.Page;
const event = id => ({ currentTarget: { dataset: { id } } });
function fixture(t, mode = 'browse') {
  const originals = { ...platform }; t.after(() => Object.assign(platform, originals));
  platform.unloadGuard = () => {}; platform.syncTab = () => {}; platform.toast = () => {};
  const disk = {}, events = []; let fail = false;
  const store = createStore({ get: key => disk[key], set(key, value) { if (fail && key === KEY) throw Error('disk full'); disk[key] = value; } });
  const date = dates.key(), id = store.add('one', date, { originalPath: '/one.jpg', subjectPath: '/one.png', width: 300, height: 300 }, date, { deferPlacement: true });
  const a = store.createLibrary('a', '随手收集'), b = store.createLibrary('b', '旅途拾光'); store.setMemoryLibraries(id, [a]);
  const card = { ...definition.methods, store, data: { ...clone(definition.data), mode, memoryId: id, covered: false }, setData(update) { Object.assign(this.data, update); }, triggerEvent(name, detail) { events.push({ name, detail }); } }; card.refresh();
  return { card, store, disk, id, a, b, date, events, fail(value) { fail = value; } };
}
test('library browsing stays in one card, retains its position under a detail card and never writes', t => {
  const f = fixture(t), c = f.card, before = f.disk[KEY];
  c.open(event(f.a)); assert.equal(c.data.libraryId, f.a); assert.equal(c.data.visibleItems[0].id, f.id);
  c.scrolled({ detail: { scrollTop: 126 } }); c.openMemory(event(f.id)); assert.equal(f.events.at(-1).name, 'memory'); assert.equal(c.data.scrollTop, 126);
  c.data.covered = true; c.open(event(f.b)); c.close(); assert.equal(c.data.libraryId, f.a); assert.equal(f.events.filter(e => e.name === 'close').length, 0);
  c.data.covered = false; c.refresh(); assert.equal(c.data.libraryId, f.a); assert.equal(c.data.scrollTop, 126);
  c.back(); assert.equal(c.data.libraryId, ''); assert.equal(f.disk[KEY], before);
});
test('picking stages multiple libraries until confirmation, supports cancellation and recovers failed storage', t => {
  const f = fixture(t, 'pick'), c = f.card;
  c.open(event(f.b)); assert.deepEqual(c.data.selectedIds.sort(), [f.a, f.b]); const before = f.disk[KEY];
  c.close(); assert.equal(f.disk[KEY], before); f.events.length = 0;
  f.fail(true); c.confirm(); assert.match(c.data.error, /空间不足/); assert.equal(f.disk[KEY], before); assert.equal(f.events.length, 0);
  f.fail(false); c.confirm(); assert.equal(f.store.get().libraries[f.b].memoryIds[0], f.id); assert.equal(f.events.at(-1).name, 'close');
  assert.equal(f.store.board(f.date).placements.length, 0);
});
test('new libraries can be created in the selector without silently filing the object or moving it', t => {
  const f = fixture(t, 'pick'), c = f.card;
  c.create(); c.nameInput({ detail: { value: '美好碎片' } }); c.saveName();
  const created = c.data.libraries.find(item => item.title === '美好碎片'); assert.ok(created); assert.equal(created.count, 0); assert.ok(c.data.selectedIds.includes(created.id));
  c.confirm(); assert.deepEqual(f.store.get().libraries[created.id].memoryIds, [f.id]); assert.equal(f.store.board(f.date).placements.length, 0);
});
test('selector refresh removes deleted libraries and a failed initial read can be retried', t => {
  const f = fixture(t, 'pick'), c = f.card;
  f.store.deleteLibrary(f.a); c.refresh(); assert.equal(c.data.selectionCount, 0); assert.deepEqual(c.data.selectedIds, []);
  const load = f.store.load; c.data.loaded = false; f.store.load = () => { throw Error('storage unavailable'); };
  c.refresh(); assert.ok(c.data.error); assert.equal(c.data.loaded, false);
  f.store.load = load; c.refresh(); assert.equal(c.data.error, ''); assert.equal(c.data.loaded, true);
});
test('gallery loads beyond the first screen and searching does not lose memberships or text', t => {
  const f = fixture(t), c = f.card;
  f.store.commit(state => { for (let i = 0; i < 40; i++) state.memories[`m_extra_${i}`] = { ...state.memories[f.id], id: `m_extra_${i}`, text: `回忆 ${i}`, createdAt: i }; });
  c.open(event('all')); assert.equal(c.data.items.length, 41); assert.equal(c.data.visibleItems.length, 30); c.more(); assert.equal(c.data.visibleItems.length, 41);
  c.search({ detail: { value: '回忆 39' } }); assert.equal(c.data.visibleItems.length, 1); assert.equal(c.data.visibleItems[0].text, '回忆 39');
});
test('calendar more menu opens appearance and libraries, freezes the board and returns from detail to the same library', t => {
  const f = fixture(t), page = { ...home, data: clone(home.data), store: f.store, setData(update) { Object.assign(this.data, update); }, selectComponent() { return { touchCancel() {} }; } };
  page.refresh(); const before = f.store.get().memories;
  page.openCalendarOptions(); assert.equal(page.data.drawer, 'calendar-options'); page.openAppearance(); assert.equal(page.data.drawer, 'appearance');
  page.texture({ currentTarget: { dataset: { value: 'long' } } }); assert.equal(f.store.board(f.date).texture, 'long'); page.closeDrawer();
  page.openCalendarOptions(); page.openMemoryLibrary(); assert.equal(page.data.libraryOpen, true); assert.equal(page.data.drawer, ''); assert.equal(page.busy(), true);
  const date = page.date; page.switchMode(); assert.equal(page.data.mode, 'calendar');
  page.openLibraryMemory({ detail: { id: f.id } }); assert.equal(page.data.memoryCardId, f.id); assert.equal(page.data.memoryCardSource, null);
  page.closeMemoryCard(); assert.equal(page.data.libraryOpen, true); assert.equal(page.date, date); page.closeMemoryLibrary(); assert.equal(page.data.libraryOpen, false);
  assert.deepEqual(f.store.get().memories, before);
});
test('result library selector never confirms placement and a stale continue cannot place through it', t => {
  const f = fixture(t), page = { store: f.store, photoTask: { committed: true, savedId: f.id, deferPlacement: true, targetBoardId: f.date }, photoNoteId: f.id, data: {},
    setData(update) { Object.assign(this.data, update); }, photoDone() {} };
  photo.openLibrary(page); assert.equal(page.data.photoLibraryOpen, true); assert.equal(photo.confirmPlacement(page), false); assert.equal(photo.finish(page), false);
  assert.equal(f.store.board(f.date).placements.length, 0);
  page.data.photoLibraryOpen = false; photo.libraryChanged(page); assert.equal(page.data.photoLibraryTitle, '随手收集');
  assert.equal(photo.finish(page, false), true); assert.equal(f.store.board(f.date).placements.length, 0);
});
test('object card offers library selection on its front and keeps flip state and notes on return', t => {
  const f = fixture(t), c = { ...memoryCard.methods, store: f.store, data: { ...clone(memoryCard.data), memoryId: f.id },
    setData(update) { Object.assign(this.data, update); }, triggerEvent() {} };
  c.refresh(); c.openLibraries(); assert.equal(c.data.libraryPickerOpen, true); assert.equal(c.data.flipped, false);
  c.flip(); c.edit(); assert.equal(c.data.flipped, false); assert.equal(c.data.editing, false);
  c.closeLibraries(); assert.equal(c.data.libraryPickerOpen, false); assert.equal(c.data.libraryCount, 1);
});
