const test = require('node:test');
const assert = require('node:assert/strict');
const recall = require('../miniprogram/core/memory-recall');
const dates = require('../miniprogram/core/date');
const { createStore, getStore, KEY, clone } = require('../miniprogram/core/store');
const actions = require('../miniprogram/core/board-actions');
let definition; global.Component = value => { definition = value; };
require('../miniprogram/components/memory-recall/index'); delete global.Component;

test('recall excludes today, future, hidden and unreadable items, and uses calendar days across DST/leap boundaries', () => {
  const memories = Object.fromEntries(['2026-10-30', '2026-11-01', '2026-10-01', '2026-10-02', '2026-10-03'].map((date, i) => [String(i), { id: String(i), date, subjectPath: `/${i}.png` }]));
  assert.deepEqual(recall.candidates(memories, { hidden: ['2'], recent: [] }, '2026-10-30', { 3: '/3.png' }).map(m => m.id), ['4']);
  assert.equal(recall.age('2024-02-28', '2024-03-01'), 2);
  assert.equal(recall.age('2026-03-07', '2026-03-09'), 2);
  assert.deepEqual(recall.preferences('{broken'), { hidden: [], recent: [] });
});

test('rotation shows all candidates before repeating, prefers older unseen objects, and can reuse a sole object', () => {
  const memories = { a: { id: 'a', date: '2026-10-29', subjectPath: '/a' }, b: { id: 'b', date: '2026-09-01', subjectPath: '/b' }, c: { id: 'c', date: '2026-08-01', subjectPath: '/c' } };
  let prefs = { hidden: [], recent: [] }, current = '', order = [];
  for (let i = 0; i < 4; i++) {
    const chosen = recall.choose(memories, prefs, '2026-10-30', current, {}, () => 0);
    current = chosen.id; order.push(current); prefs = recall.shown(prefs, current);
  }
  assert.deepEqual(order, ['b', 'c', 'a', 'b']);
  assert.equal(recall.choose({ a: memories.a }, prefs, '2026-10-30', 'a', {}).id, 'a');
  assert.equal(recall.choose({}, prefs, '2026-10-30', '', {}), null);
});

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldWx = global.wx, oldKey = dates.key; dates.key = () => '2026-10-30';
  const disk = {}, events = []; let fail = false;
  global.wx = { getStorageSync: key => disk[key], setStorageSync(key, value) { if (fail && key === recall.KEY) throw Error('disk full'); disk[key] = value; } };
  const seed = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
  for (const [id, date] of [['a','2026-09-01'],['b','2026-09-18'],['c','2026-10-29']]) seed.add(id, date, { originalPath: `/${id}.jpg`, subjectPath: `/${id}.png`, width: 100, height: 100, kind: 'original' });
  getStore().load();
  const c = { ...definition.methods, data: { ...clone(definition.data), active: true, editing: false, recording: false, blocked: false, open: false },
    setData(update) { Object.assign(this.data, update); }, triggerEvent(type, detail) { events.push({ type, detail }); } };
  c.props = update => { Object.assign(c.data, update); definition.observers['active, editing, recording, blocked, open'].call(c); };
  definition.lifetimes.attached.call(c);
  t.after(() => { definition.lifetimes.detached.call(c); global.wx = oldWx; dates.key = oldKey; });
  return { c, disk, events, fail(value) { fail = value; }, snapshot: disk[KEY] };
}

test('45-second idle rotation survives ordinary refreshes and pauses while a finger is held', t => {
  const { c, disk, snapshot } = fixture(t), initial = c.data.item.id;
  t.mock.timers.tick(30000); c.sync(); t.mock.timers.tick(14999); assert.equal(c.data.item.id, initial);
  t.mock.timers.tick(1); assert.notEqual(c.data.item.id, initial);
  const next = c.data.item.id; c.touch(true); t.mock.timers.tick(90000); assert.equal(c.data.item.id, next);
  c.touch(false); t.mock.timers.tick(44999); assert.equal(c.data.item.id, next);
  t.mock.timers.tick(1); assert.notEqual(c.data.item.id, next); assert.equal(disk[KEY], snapshot);
});

test('editing and the entire recording/placement state hide the preview and rotate once on completion', t => {
  const { c, events, disk, snapshot } = fixture(t);
  for (const reason of ['editing', 'recording']) {
    const before = c.data.item.id;
    c.props({ [reason]: true }); assert.equal(events.at(-1).detail.item, null);
    t.mock.timers.tick(90000); assert.equal(c.data.item.id, before);
    c.props({ blocked: true }); c.props({ [reason]: false }); assert.equal(events.at(-1).detail.item, null);
    c.props({ blocked: false }); assert.notEqual(c.data.item.id, before); assert.ok(events.at(-1).detail.item);
  }
  assert.equal(disk[KEY], snapshot);
});

test('old object review stays pinned; ordinary closing resumes timing without changing the selected object', t => {
  const { c, events, disk, snapshot } = fixture(t), initial = c.data.item.id;
  c.props({ open: true }); t.mock.timers.tick(90000); assert.equal(c.data.item.id, initial);
  c.next(); assert.notEqual(c.data.item.id, initial);
  const shown = c.data.item.id; c.close(); t.mock.timers.tick(219); assert.equal(events.at(-1).type, 'closing');
  t.mock.timers.tick(1); assert.equal(events.at(-1).type, 'close'); assert.deepEqual(events.at(-1).detail, {}); c.props({ open: false });
  assert.equal(c.data.closing, false); assert.equal(c.data.item.id, shown);
  t.mock.timers.tick(44999); assert.equal(c.data.item.id, shown); t.mock.timers.tick(1); assert.notEqual(c.data.item.id, shown);
  assert.equal(disk[KEY], snapshot);
});

test('detail preparation pauses during touch, opening and backgrounding; only the current preview can be displayed', t => {
  const { c } = fixture(t);
  assert.equal(c.data.subjectActive, true); c.touch(true); assert.equal(c.data.subjectActive, false);
  c.touch(false); assert.equal(c.data.subjectActive, true);
  c.subjectReady({ detail: { path: '/stale.png', previewPath: '/old-preview.png' } }); assert.equal(c.data.subjectPreview, '');
  c.subjectReady({ detail: { path: c.data.item.path, previewPath: '/ready.png' } }); assert.equal(c.data.subjectPreview, '/ready.png');
  c.props({ open: true }); assert.equal(c.data.subjectActive, false);
  t.mock.timers.tick(419); assert.equal(c.data.subjectActive, false);
  t.mock.timers.tick(1); assert.equal(c.data.subjectActive, true);
  definition.pageLifetimes.hide.call(c); assert.equal(c.data.subjectActive, false);
  definition.pageLifetimes.show.call(c); assert.equal(c.data.subjectActive, true);
  c.close(); assert.equal(c.data.subjectActive, false);
});

test('view that day closes once with the pinned memory date after the exit transition', t => {
  const { c, events, disk, snapshot } = fixture(t); c.props({ open: true });
  const { id, date } = c.data.item;
  c.showDay(); assert.equal(c.data.closing, true); assert.equal(events.at(-1).type, 'closing');
  c.showDay(); c.next(); c.close(); assert.equal(c.data.item.id, id);
  t.mock.timers.tick(219); assert.equal(events.filter(e => e.type === 'close').length, 0);
  t.mock.timers.tick(1); assert.deepEqual(events.filter(e => e.type === 'close'), [{ type: 'close', detail: { date } }]);
  assert.equal(disk[KEY], snapshot);
});

test('invalid dates and late callbacks cannot navigate from a closed or detached recall panel', t => {
  const { c, events } = fixture(t);
  c.showDay(); assert.equal(events.some(e => e.type === 'closing'), false);
  c.props({ open: true }); const item = c.data.item;
  for (const date of ['invalid', '2026-11-01']) { c.setData({ item: { ...item, date } }); c.showDay(); assert.ok(c.data.error); assert.equal(c.data.closing, false); }
  c.setData({ item }); c.showDay(); c.props({ open: false }); t.mock.timers.tick(220);
  assert.equal(events.some(e => e.type === 'close'), false);
  c.props({ open: true }); c.showDay(); definition.lifetimes.detached.call(c); t.mock.timers.tick(220);
  assert.equal(events.some(e => e.type === 'close'), false);
});

test('backgrounding suspends rotation, reentry and return to today refresh it, and disposal cancels callbacks', t => {
  const { c, events } = fixture(t), first = c.data.item.id;
  definition.pageLifetimes.hide.call(c); t.mock.timers.tick(90000); assert.equal(c.data.item.id, first);
  definition.pageLifetimes.show.call(c); assert.notEqual(c.data.item.id, first);
  const second = c.data.item.id; c.props({ active: false }); t.mock.timers.tick(90000); assert.equal(c.data.item.id, second);
  c.props({ active: true }); assert.notEqual(c.data.item.id, second);
  definition.lifetimes.detached.call(c); const count = events.length; t.mock.timers.tick(90000); assert.equal(events.length, count);
});

test('hiding is reversible, storage failure preserves the item, missing images fall back, and journal data stays unchanged', t => {
  const { c, fail, disk, snapshot } = fixture(t); c.props({ open: true });
  const first = c.data.item.id; fail(true); c.hideItem(); assert.equal(c.data.item.id, first); assert.ok(c.data.error);
  fail(false); c.hideItem(); assert.notEqual(c.data.item.id, first); assert.equal(c.data.hiddenCount, 1);
  c.hideItem(); c.hideItem(); assert.equal(c.data.item, null); assert.equal(c.data.hiddenCount, 3);
  c.restoreHidden(); assert.ok(c.data.item); assert.equal(c.data.hiddenCount, 0);
  const item = c.data.item; c.imageFailed({ detail: { id: item.id, path: item.path } }); assert.notEqual(c.data.item.id, item.id);
  c.imageFailed({ detail: { id: item.id, path: '/stale.png' } }); assert.ok(c.data.item);
  assert.equal(disk[KEY], snapshot);
});

test('corner actions do not overlap Add on small screens and have no hit target while editing, covered or disabled', () => {
  for (const width of [267, 300, 338, 378]) {
    const base = { interactive: true, floatingControls: { label: '添加记忆', offsetY: 42, recall: { age: '42 天前' } }, compactFloating: width < 300 };
    const list = actions.layout(width, 400, base), add = list.find(a => a.action === 'record'), card = list.find(a => a.action === 'recall');
    assert.ok(card.width >= 48); assert.ok(card.x + card.width < add.x);
    assert.equal(actions.hit(list, { x: card.x + card.width / 2, y: card.y + card.height / 2 }).action, 'recall');
    for (const patch of [{ editable: true }, { selected: 'a' }, { covered: true }, { dragging: true }, { floatingControls: { ...base.floatingControls, disabled: true } }]) {
      assert.equal(actions.layout(width, 400, { ...base, ...patch }).some(a => a.action === 'recall'), false);
    }
  }
});
