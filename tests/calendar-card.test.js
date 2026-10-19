const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const platform = require('../miniprogram/services/platform');
let calendarDefinition, cardDefinition;
global.Page = value => { calendarDefinition = value; };
require('../miniprogram/pages/calendar/index'); delete global.Page;
global.Component = value => { cardDefinition = value; };
require('../miniprogram/components/day-board-card/index'); delete global.Component;
const event = date => ({ currentTarget: { dataset: { date } } });

test('closing a day card with sharing open dismisses sharing first and retains the same date', async t => {
  const f = fixture(t), p = f.card, before = f.store.get();
  p.exportBoard(); assert.equal(p.data.shareBoardId, f.date);
  p.selectComponent = selector => selector === '#share-card' ? { back: () => p.closeShareCard() } : null;
  await p.close(); assert.equal(p.data.shareBoardId, ''); assert.deepEqual(f.events, []);
  assert.equal(p.date, f.date); assert.deepEqual(f.store.get(), before); assert.deepEqual(f.navigation, []);
  await p.close(); assert.deepEqual(f.events, ['close']);
});

function fixture(t, withMemory = true) {
  const originalWx = global.wx, originalPlatform = { ...platform }, navigation = [], tabs = [], events = [], disk = {};
  t.after(() => { global.wx = originalWx; Object.assign(platform, originalPlatform); });
  global.wx = { navigateTo: options => navigation.push(options.url) };
  platform.back = () => navigation.push('back'); platform.syncTab = (page, active, hidden) => tabs.push({ active, hidden });
  platform.unloadGuard = () => {}; platform.toast = () => {}; platform.call = async () => ({ confirm: true });
  let failing = false;
  const store = createStore({ get: key => disk[key], set(key, value) { if (failing && key === KEY) throw Error('disk full'); disk[key] = value; } });
  const date = '2024-02-12';
  const id = withMemory && store.add('calendar_card', date, { originalPath: '/photo.jpg', subjectPath: '/subject.png', width: 400, height: 300 });
  const calendar = { ...calendarDefinition, data: clone(calendarDefinition.data), year: 2024, month: 2, store,
    setData(update) { Object.assign(this.data, update); } };
  const card = { ...cardDefinition.methods, data: { ...clone(cardDefinition.data), boardDate: date }, date, store,
    setData(update) { Object.assign(this.data, update); }, triggerEvent(name) { events.push(name); }, selectComponent() { return { touchCancel() {} }; } };
  calendar.refresh(); card.refresh();
  return { calendar, card, store, date, id, navigation, tabs, events, fail(value) { failing = value; } };
}

test('calendar opens and closes a board card without navigation, writes or changing its month', t => {
  const f = fixture(t), p = f.calendar, before = f.store.get();
  p.open(event(f.date)); assert.equal(p.data.boardDate, f.date); assert.deepEqual(f.tabs.at(-1), { active: 'calendar', hidden: true });
  p.open(event('2024-02-13')); p.previous(); p.current(); p.memories(); p.categories();
  assert.equal(p.data.boardDate, f.date); assert.equal(p.month, 2); assert.equal(p.year, 2024); assert.deepEqual(f.navigation, []);
  p.closeBoard(); assert.equal(p.data.boardDate, ''); assert.equal(p.month, 2); assert.equal(p.year, 2024);
  assert.deepEqual(f.tabs.at(-1), { active: 'calendar', hidden: false }); assert.deepEqual(f.store.get(), before);
});

test('blank, invalid and future days cannot open cards; empty historical days can', t => {
  const f = fixture(t, false), p = f.calendar, before = f.store.get();
  for (const value of ['', undefined, '2024-02-30', '2099-01-01']) { p.open(event(value)); assert.equal(p.data.boardDate, ''); }
  for (const key of ['loading', 'error']) { p.data[key] = true; p.open(event(f.date)); assert.equal(p.data.boardDate, ''); p.data[key] = key === 'error' ? '' : false; }
  p.open(event(f.date)); assert.equal(p.data.boardDate, f.date); assert.deepEqual(f.store.get(), before);
});

test('closing after a board change refreshes calendar previews and totals in the same month', t => {
  const f = fixture(t), p = f.calendar; p.open(event(f.date));
  f.store.unplace(f.id, f.date); p.boardChanged();
  assert.equal(p.data.boardDate, f.date); assert.equal(p.data.itemCount, 0); assert.equal(p.data.dayCount, 0);
  assert.deepEqual(p.data.cells.find(c => c.date === f.date).images, []);
  p.closeBoard(); assert.equal(p.month, 2); assert.deepEqual(f.navigation, []);
});

test('reading and closing an empty day does not create a stored board', async t => {
  const f = fixture(t, false), before = f.store.get();
  assert.equal(f.card.data.count, 0); assert.equal(f.card.data.canEdit, false); assert.equal(f.card.data.editable, false);
  await f.card.close(); assert.deepEqual(f.events, ['close']); assert.deepEqual(f.navigation, []); assert.deepEqual(f.store.get(), before);
});

test('day card supports long-press transforms and finish without closing or navigating', async t => {
  const f = fixture(t), p = f.card;
  p.editItem({ detail: { id: f.id } }); assert.equal(p.data.selected, f.id); assert.equal(p.data.editable, true);
  p.transform({ detail: { op: 'cw' } }); assert.equal(f.store.board(f.date).placements[0].angle, 15); assert.ok(f.events.includes('change'));
  p.done(); assert.equal(p.data.editable, false); assert.equal(p.data.selected, ''); assert.equal(f.events.includes('close'), false);
  await p.close(); assert.equal(f.events.at(-1), 'close'); assert.deepEqual(f.navigation, []);
});

test('nested memory card keeps the day card open and returns to its exact editing state', async t => {
  const f = fixture(t), p = f.card;
  p.editItem({ detail: { id: f.id } }); p.memory({ detail: { id: f.id } });
  assert.equal(p.data.memoryCardId, f.id); await p.close(); assert.equal(f.events.includes('close'), false);
  f.store.edit(f.id, '更新后的说明', '日常'); p.memoryCardChanged();
  assert.equal(p.data.model.items[0].memory.text, '更新后的说明'); assert.ok(f.events.includes('change'));
  p.closeMemoryCard(); assert.equal(p.data.memoryCardId, ''); assert.equal(p.data.selected, f.id); assert.equal(p.data.editable, true);
  assert.equal(p.date, f.date); assert.deepEqual(f.navigation, []);
});

test('failed layout save blocks closing; retry then closes the modal without leaving calendar', async t => {
  const f = fixture(t), p = f.card;
  p.editItem({ detail: { id: f.id } }); f.fail(true); p.transform({ detail: { op: 'cw' } });
  await p.close(); assert.equal(p.dirty, true); assert.equal(f.events.includes('close'), false); assert.equal(f.store.board(f.date).placements[0].angle, 0);
  f.fail(false); await p.close(); assert.equal(f.store.board(f.date).placements[0].angle, 15); assert.equal(f.events.at(-1), 'close'); assert.deepEqual(f.navigation, []);
});

test('day card memory library stays inline and closing its drawer leaves the board open', async t => {
  const f = fixture(t), p = f.card;
  p.editItem({ detail: { id: f.id } }); await p.library(); assert.equal(p.data.drawer, 'library');
  await p.close(); assert.equal(p.data.drawer, ''); assert.equal(f.events.includes('close'), false); assert.deepEqual(f.navigation, []);
});

test('backgrounding and resuming retains the chosen date and hidden calendar navigation', t => {
  const f = fixture(t), p = f.calendar;
  t.after(() => p.onHide()); p.open(event(f.date)); p.onShow();
  assert.equal(p.data.boardDate, f.date); assert.equal(p.month, 2); assert.equal(p.year, 2024); assert.equal(f.tabs.at(-1).hidden, true);
  cardDefinition.pageLifetimes.hide.call(f.card); cardDefinition.pageLifetimes.show.call(f.card);
  assert.equal(f.card.date, f.date); assert.equal(f.card.data.dateLabel, dates.label(f.date)); assert.deepEqual(f.navigation, []);
});
