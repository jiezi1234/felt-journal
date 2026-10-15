const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../miniprogram/services/platform');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
const { createStore, clone } = require('../miniprogram/core/store');
let navDefinition, boardDefinition;
global.Component = value => { navDefinition = value; };
require('../miniprogram/components/main-nav/index');
delete global.Component;
global.Page = value => { boardDefinition = value; };
require('../miniprogram/pages/board-tab/index');
delete global.Page;
const event = id => ({ currentTarget: { dataset: { id } } });

function navFixture(t, route) {
  const original = { ...platform }, originalPages = global.getCurrentPages;
  t.after(() => { Object.assign(platform, original); global.getCurrentPages = originalPages; });
  global.getCurrentPages = () => [{ route }];
  return Object.assign({}, navDefinition.methods, { data: { active: 'board', navigating: false }, setData(value) { Object.assign(this.data, value); } });
}

test('bottom navigation switches cached tabs, ignores current tab, and takes historical boards to today', async t => {
  const nav = navFixture(t, 'pages/board-tab/index'), calls = [];
  platform.call = async (method, options) => calls.push({ method, ...options });
  await nav.open(event('board')); await nav.open(event('unknown')); assert.equal(calls.length, 0);
  await nav.open(event('calendar'));
  global.getCurrentPages = () => [{ route: 'pages/board/index' }];
  await nav.open(event('board'));
  assert.deepEqual(calls, [{ method: 'switchTab', url: '/pages/calendar/index' }, { method: 'switchTab', url: '/pages/board-tab/index' }]);
});

test('rapid navigation is serialized and failed switching leaves a retryable navigation bar', async t => {
  const nav = navFixture(t, 'pages/index/index'); let finish, calls = 0, message;
  platform.call = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = nav.open(event('board')); await nav.open(event('calendar')); assert.equal(calls, 1);
  finish(); await first; assert.equal(nav.data.navigating, false);
  platform.call = async () => { throw new Error('offline'); }; platform.toast = value => { message = value; };
  await nav.open(event('board')); assert.equal(message, 'offline'); assert.equal(nav.data.navigating, false);
});

test('returning from a child pops its page; root return switches to the cached home', t => {
  const originalPages = global.getCurrentPages, originalWx = global.wx;
  t.after(() => { global.getCurrentPages = originalPages; global.wx = originalWx; });
  const calls = []; global.wx = { navigateBack() { calls.push('back'); }, switchTab(value) { calls.push(value.url); } };
  global.getCurrentPages = () => [{}, {}]; platform.back();
  global.getCurrentPages = () => [{}]; platform.back();
  assert.deepEqual(calls, ['back', '/pages/index/index']);
});

function boardFixture(t) {
  const originals = { ...platform }, originalKey = dates.key;
  t.after(() => { Object.assign(platform, originals); dates.key = originalKey; });
  const disk = {}, store = createStore({ get: key => disk[key], set(key, value) { disk[key] = value; } });
  return Object.assign({}, boardDefinition, { data: clone(boardDefinition.data), store, setData(value) { Object.assign(this.data, value); } });
}

test('cached board refreshes saved changes and advances to the new day without creating records', t => {
  const page = boardFixture(t), originalDate = dates.key(), before = page.store.get(); page.refresh();
  assert.equal(page.data.date, originalDate);
  assert.deepEqual(page.store.get(), before);
  const board = page.store.board(originalDate); board.color = config.colors[1].value; page.store.saveBoard(board);
  page.refresh(); assert.equal(page.data.model.color, config.colors[1].value);
  dates.key = () => '2099-01-02'; page.refresh();
  assert.equal(page.data.date, '2099-01-02'); assert.equal(page.data.count, 0); assert.equal(page.store.get().boards['2099-01-02'], undefined);
});

test('board tab opens dated edit/add as a child and prevents duplicate openings', async t => {
  const page = boardFixture(t); page.refresh(); const calls = []; let finish;
  platform.call = (method, options) => { calls.push({ method, ...options }); return new Promise(resolve => { finish = resolve; }); };
  const first = page.openEditor(false); await page.openEditor(true); finish(); await first;
  platform.call = async (method, options) => calls.push({ method, ...options }); await page.openEditor(true);
  assert.deepEqual(calls, [{ method: 'navigateTo', url: `/pages/board/index?date=${dates.key()}&mode=edit` }, { method: 'navigateTo', url: `/pages/board/index?date=${dates.key()}&mode=edit&add=1` }]);
});
