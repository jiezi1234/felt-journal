const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../miniprogram/services/platform');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
const { createStore, clone } = require('../miniprogram/core/store');
let navDefinition, boardDefinition, tabDefinition;
global.Component = value => { navDefinition = value; };
require('../miniprogram/components/main-nav/index');
global.Component = value => { tabDefinition = value; };
require('../miniprogram/custom-tab-bar/index');
delete global.Component;
global.Page = value => { boardDefinition = value; };
require('../miniprogram/pages/board-tab/index');
delete global.Page;
const event = id => ({ currentTarget: { dataset: { id } } });

test('custom tab lifecycle respects open theme forms and restores navigation after dismissal', t => {
  const originalPages = global.getCurrentPages;
  t.after(() => { global.getCurrentPages = originalPages; });
  const page = { route: 'pages/board-tab/index', data: { formOpen: true } };
  global.getCurrentPages = () => [page];
  const tab = { ...tabDefinition.methods, data: clone(tabDefinition.data), setData(value) { Object.assign(this.data, value); } };
  tabDefinition.lifetimes.attached.call(tab); assert.deepEqual(tab.data, { active: 'board', hidden: true });
  tabDefinition.pageLifetimes.show.call(tab); assert.equal(tab.data.hidden, true);
  page.data.formOpen = false; tabDefinition.pageLifetimes.show.call(tab); assert.equal(tab.data.hidden, false);
  page.data.inlineTheme = true; page.data.drawer = 'library'; tabDefinition.pageLifetimes.show.call(tab); assert.equal(tab.data.hidden, true);
  page.data.drawer = ''; tab.sync(); assert.equal(tab.data.hidden, false);
  page.data.task = { state: 'choosing' }; tab.sync(); assert.equal(tab.data.hidden, true);
  page.data.task = null; page.data.placing = { id: 'photo' }; tab.sync(); assert.equal(tab.data.hidden, true);
  page.data.placing = null; tab.sync(); assert.equal(tab.data.hidden, false);
  page.route = 'pages/index/index'; page.data = { editorOpen: true }; tab.sync(); assert.deepEqual(tab.data, { active: 'today', hidden: true });
  page.route = 'pages/calendar/index'; page.data = {}; tab.sync(); assert.deepEqual(tab.data, { active: 'calendar', hidden: false });
  page.data.boardDate = '2024-02-12'; tabDefinition.pageLifetimes.show.call(tab); assert.deepEqual(tab.data, { active: 'calendar', hidden: true });
  page.data.boardDate = ''; tab.sync(); assert.equal(tab.data.hidden, false);
});

function navFixture(t, route) {
  const original = { ...platform }, originalPages = global.getCurrentPages;
  t.after(() => { Object.assign(platform, original); global.getCurrentPages = originalPages; });
  global.getCurrentPages = () => [{ route }];
  return Object.assign({}, navDefinition.methods, { data: { active: 'board', navigating: false }, setData(value) { Object.assign(this.data, value); } });
}

test('bottom navigation switches cached tabs, ignores current tab, and opens the theme collection from a child', async t => {
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

test('theme tab excludes daily boards, refreshes renamed themes, and does not create records on day rollover', t => {
  const page = boardFixture(t), originalDate = dates.key();
  page.store.saveBoard(page.store.board(originalDate));
  page.store.createTheme('travel', '旅途');
  const before = page.store.get(); page.refresh();
  assert.equal(page.data.isTab, true);
  assert.deepEqual(page.data.themes.map(b => b.id), ['theme_travel']);
  assert.deepEqual(page.store.get(), before);
  page.store.renameTheme('theme_travel', '每一次出发');
  page.refresh(); assert.equal(page.data.themes[0].title, '每一次出发');
  dates.key = () => '2099-01-02'; page.refresh();
  assert.equal(page.data.themes.length, 1); assert.equal(page.store.get().boards['2099-01-02'], undefined);
});

test('theme tab arranges its selected board in place without opening a child', t => {
  const page = boardFixture(t); page.store.createTheme('travel', '旅途'); page.refresh(); const calls = [];
  platform.call = async (method, options) => calls.push({ method, ...options });
  const before = page.store.get(); page.open(event('theme_travel')); page.open(event('theme_travel'));
  assert.deepEqual(calls, []); assert.equal(page.data.editable, true); assert.equal(page.data.model.id, 'theme_travel');
  assert.deepEqual(page.store.get(), before);
});
