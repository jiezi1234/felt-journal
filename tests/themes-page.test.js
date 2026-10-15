const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, KEY, clone } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const platform = require('../miniprogram/services/platform');
function definition(name) { let page; global.Page = value => { page = value; }; require(`../miniprogram/pages/${name}/index`); delete global.Page; return page; }
const themes = definition('themes'), memories = definition('memories'), board = definition('board');
const event = id => ({ currentTarget: { dataset: { id } } });
function fixture(t) {
  const original = { ...platform }; t.after(() => Object.assign(platform, original));
  const calls = [], toasts = [], disk = {}; let backs = 0, fail = false;
  platform.call = async (name, options) => { calls.push({ name, options }); return { confirm: true }; };
  platform.toast = text => toasts.push(text); platform.back = () => { backs++; }; platform.unloadGuard = () => {}; platform.confirmRemovePlacement = async () => true;
  const store = createStore({ get: key => disk[key], set: (key, value) => { if (fail && key === KEY) throw new Error('quota exceeded'); disk[key] = value; } }), date = dates.key();
  const today = store.add('today', date, { originalPath: '/today.jpg', subjectPath: '/today.png', width: 400, height: 300 });
  const past = store.add('past', '2024-02-29', { originalPath: '/past.jpg', subjectPath: '/past.png', width: 400, height: 300 });
  const page = (definition, extra = {}) => ({ ...definition, store, data: clone(definition.data), setData(update) { Object.assign(this.data, update); }, ...extra });
  return { store, disk, calls, toasts, date, today, past, page, backs: () => backs, fail(value) { fail = value; } };
}
test('theme creation keeps the form on failed save and retries without creating duplicate boards', async t => {
  const f = fixture(t), p = f.page(themes, { memoryId: '' }); p.refresh(); p.create(); p.input({ detail: { value: '秋天的散步' } }); const raw = f.disk[KEY];
  f.fail(true); await p.save(); assert.equal(p.data.formOpen, true); assert.equal(p.data.title, '秋天的散步'); assert.match(p.data.formError, /空间不足/); assert.equal(f.disk[KEY], raw);
  f.fail(false); await p.save(); assert.equal(p.data.formOpen, false); assert.equal(p.data.themes.length, 1); assert.match(f.calls.at(-1).options.url, /board=theme_.+&mode=edit/);
  await p.save(); assert.equal(p.data.themes.length, 1);
});
test('memory-to-theme selection creates and places atomically, marks existing placements, and returns', async t => {
  const f = fixture(t), p = f.page(themes, { memoryId: f.past }); p.data.selecting = true; p.refresh(); p.create(); p.input({ detail: { value: '跨年旅行' } }); await p.save();
  const id = p.data.themes[0].id; assert.equal(f.store.view(id).items[0].memoryId, f.past); assert.equal(f.backs(), 1); assert.equal(p.data.themes[0].placed, true);
  const raw = f.disk[KEY]; await p.open(event(id)); assert.equal(f.disk[KEY], raw); assert.equal(f.backs(), 1);
  const another = f.store.createTheme('another', '另一块'); p.refresh(); await p.open(event(another)); assert.equal(f.store.boardsForMemory(f.past).length, 3); assert.equal(f.backs(), 2);
});
test('theme rename and confirmed deletion preserve memory while cancellation preserves the board', async t => {
  const f = fixture(t), id = f.store.createTheme('one', '初始', f.today), p = f.page(themes, { memoryId: '' }); p.refresh(); p.rename(event(id)); p.input({ detail: { value: '重命名后' } }); await p.save();
  assert.equal(p.data.themes[0].title, '重命名后'); platform.call = async () => ({ confirm: false }); await p.remove(event(id)); assert.ok(f.store.get().boards[id]);
  platform.call = async () => ({ confirm: true }); await p.remove(event(id)); assert.equal(p.data.themes.length, 0); assert.ok(f.store.get().memories[f.today]); assert.equal(f.store.get().garbage.length, 0);
});
test('navigation failure after creating a theme is visible and does not lose the created board', async t => {
  const f = fixture(t), p = f.page(themes, { memoryId: '' }); p.refresh(); p.create(); p.input({ detail: { value: '已保存的板' } });
  platform.call = async () => { throw new Error('页面打开失败'); }; await p.save(); assert.equal(p.data.formOpen, false); assert.equal(p.data.themes.length, 1); assert.match(f.toasts.at(-1), /页面打开失败/);
});
test('theme picker includes past/unplaced memories, shows duplicates, emits selection, and ignores double taps', async t => {
  const f = fixture(t), theme = f.store.createTheme('one', '主题', f.today); f.store.unplace(f.past, '2024-02-29'); const notifications = [];
  const p = f.page(memories, { target: theme, missingPaths: new Set(), getOpenerEventChannel: () => ({ emit: (name, detail) => notifications.push({ name, detail }) }) });
  p.refresh(); assert.equal(p.data.total, 2); assert.equal(p.data.targetDaily, false); const raw = f.disk[KEY];
  await p.open(event(f.today)); assert.equal(f.disk[KEY], raw);
  await p.open(event(f.past)); await p.open(event(f.past)); assert.equal(f.backs(), 1); assert.equal(f.store.board(theme).placements.length, 2);
  assert.deepEqual(notifications, [{ name: 'placed', detail: { id: f.past, boardId: theme } }]);
});
test('daily picker only restores its original day; failed placement retains filters and can retry', async t => {
  const f = fixture(t); f.store.unplace(f.past, '2024-02-29');
  const p = f.page(memories, { target: '2024-02-29', missingPaths: new Set() }); p.refresh(); assert.equal(p.data.targetDaily, true); assert.equal(p.data.total, 1); assert.equal(p.data.groups[0].items[0].id, f.past);
  const raw = f.disk[KEY]; f.fail(true); await p.open(event(f.past)); assert.equal(p.data.placing, false); assert.equal(f.disk[KEY], raw); assert.equal(f.backs(), 0);
  f.fail(false); await p.open(event(f.past)); assert.equal(f.backs(), 1); assert.equal(f.store.board('2024-02-29').placements.length, 1);
});
test('deleted target and deleted source show errors rather than opening an unrelated library or theme list', t => {
  const f = fixture(t), picker = f.page(memories, { target: 'theme_missing', missingPaths: new Set() }); picker.refresh(); assert.match(picker.data.error, /不存在/); assert.equal(picker.data.groups.length, 0);
  const p = f.page(themes, { memoryId: 'missing' }); p.refresh(); assert.match(p.data.error, /已被删除/); assert.equal(p.data.themes.length, 0);
});
test('theme board layout/removal are independent; undo cannot put the removed memory back', async t => {
  const f = fixture(t), theme = f.store.createTheme('one', '主题', f.today), daily = f.store.board(f.date);
  const p = f.page(board, { date: theme, wantEdit: true }); p.refresh(); assert.equal(p.data.isTheme, true); assert.equal(p.data.dateLabel, '主题');
  p.select({ detail: { id: f.today } }); p.transform({ detail: { op: 'cw' } }); assert.deepEqual(f.store.board(f.date), daily); assert.equal(p.data.canUndo, true);
  await p.remove(); p.undo(); assert.equal(p.data.count, 0); assert.equal(p.data.canUndo, false); assert.ok(f.store.get().memories[f.today]); assert.deepEqual(f.store.board(f.date), daily);
  await p.library(); const request = f.calls.at(-1); assert.match(request.options.url, /target=theme_one/);
  f.store.place(f.past, theme); request.options.events.placed({ id: f.past, boardId: theme }); p.onShow(); assert.equal(p.data.selected, f.past); assert.equal(p.data.editable, true);
});
