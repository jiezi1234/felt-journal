// Native acceptance uses isolated records and restores the original storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1'];

(async () => {
  let mini, backup;
  const checks = [], errors = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
  const state = () => mini.evaluate(() => {
    const p = getCurrentPages().slice(-1)[0], tab = p.getTabBar();
    return { route: p.route, depth: getCurrentPages().length, marker: p.acceptanceMarker, data: p.data, nav: !!tab.selectComponent('#main-nav') };
  });
  async function call(method, arg) {
    await mini.evaluate((method, arg) => getCurrentPages().slice(-1)[0][method](arg), method, arg);
    await pause(180);
    const s = await state();
    assert.equal(s.route, 'pages/board-tab/index'); assert.equal(s.depth, 1); assert.equal(s.marker, 'same-theme-page'); assert.equal(s.data.error, '');
    return s;
  }
  const event = id => ({ currentTarget: { dataset: { id } } });
  async function inspect(name, selectors, navVisible) {
    const s = await state(); assert.equal(s.nav, navVisible, name + ' navigation');
    const result = await mini.evaluate(selectors => new Promise(resolve => {
      const p = getCurrentPages().slice(-1)[0], q = wx.createSelectorQuery().in(p);
      selectors.forEach(selector => q.select(selector).boundingClientRect());
      q.exec(rects => resolve({ height: wx.getWindowInfo().windowHeight, rects }));
    }), selectors);
    for (const rect of result.rects) {
      assert.ok(rect && rect.width > 0 && rect.height > 0, name + ' missing control');
      assert.ok(rect.top >= -1 && rect.bottom <= result.height + 1, name + ' outside viewport: ' + JSON.stringify(rect));
    }
    if (navVisible) {
      const nav = await mini.evaluate(() => new Promise(resolve => getCurrentPages().slice(-1)[0].getTabBar().selectComponent('#main-nav').createSelectorQuery().select('.main-nav').boundingClientRect(resolve).exec()));
      assert.ok(result.rects.every(rect => rect.bottom <= nav.top), name + ' overlaps bottom navigation');
    }
    await mini.evaluate(() => wx.pageScrollTo({ scrollTop: 10000, duration: 0 }));
    const scroll = await mini.evaluate(() => new Promise(resolve => wx.createSelectorQuery().selectViewport().scrollOffset(r => resolve(r.scrollTop)).exec()));
    assert.ok(scroll <= 1, name + ' scrolls');
    checks.push({ name, ...result }); console.log('PASS:', name);
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', error => errors.push(error)); backup = await snapshot();
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const photo = { originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72 }, ids = [];
    for (let i = 0; i < 7; i++) ids.push(store.add('theme_inline_' + i, i % 2 ? '2024-01-01' : dates.key(), photo));
    const daily = store.board(dates.key());
    await mini.evaluate((keys, value) => { keys.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(keys[0], value); }, keys, disk[keys[0]]);
    await mini.evaluate(() => new Promise((resolve, reject) => wx.reLaunch({ url: '/pages/board-tab/index', success: resolve, fail: reject }))); await pause(700);
    await mini.evaluate(() => { getCurrentPages().slice(-1)[0].acceptanceMarker = 'same-theme-page'; });
    await call('create'); await inspect('create form', ['.theme-form', '#save-theme', '#cancel-theme'], false);
    await call('input', { detail: { value: '秋日散步与旅行途中收集的那些值得珍藏的小小日常和温柔时光记忆' } });
    let s = await call('save'); const first = s.data.date;
    assert.equal(s.data.editable, true); assert.equal(s.data.formOpen, false);
    await inspect('new board in the existing page', ['.theme-stage', '#finish-theme', '#add-theme-memory', '#more-theme', '#next-theme'], true);
    const initialRect = checks.at(-1).rects[0];
    await call('library'); await inspect('memory drawer', ['.drawer-sheet', '.library-memory', '.library-pagination'], false);
    const seen = []; for (let i = 0; i < 3; i++) { seen.push(...(await state()).data.visibleLibraryItems.map(m => m.id)); await call('libraryNext'); }
    assert.equal(new Set(seen).size, 7);
    s = await call('placeFromLibrary', event(ids[1])); assert.equal(s.data.selected, ids[1]); assert.equal(s.data.count, 1); assert.equal(s.nav, true);
    const angle = s.data.model.items[0].angle;
    s = await call('transform', { detail: { op: 'cw' } }); assert.notEqual(s.data.model.items[0].angle, angle);
    s = await call('undo'); assert.equal(s.data.model.items[0].angle, angle);
    s = await call('redo'); assert.notEqual(s.data.model.items[0].angle, angle);
    await call('openSelection'); await inspect('selected memory and theme actions', ['.drawer-sheet', '#edit-memory', '#layer-front', '#remove-placement', '#rename-theme', '#delete-theme', '#share-theme'], false);
    await call('memory'); await inspect('inline note editor', ['.drawer-sheet', '#record-note', '#save-record-note'], false);
    await call('noteInput', { detail: { value: '留在这块主题板上的小记忆' } }); s = await call('saveNote'); assert.equal(s.nav, true);
    assert.equal(s.data.model.items[0].memory.text, '留在这块主题板上的小记忆');
    await call('openSelection'); await call('rename'); await call('input', { detail: { value: '我的旅行' } }); s = await call('save');
    assert.equal(s.data.date, first); assert.equal(s.data.model.title, '我的旅行');
    await call('create'); await call('input', { detail: { value: '第二块主题板' } }); s = await call('save'); const second = s.data.date;
    assert.notEqual(first, second); assert.equal(s.data.count, 0); assert.equal(s.data.canUndo, false);
    s = await call('open', event(first)); assert.equal(s.data.count, 1); assert.equal(s.data.canUndo, false); assert.equal(s.data.selected, '');
    await call('done'); await inspect('completed board stays in place', ['.theme-stage', '#arrange-theme', '#add-theme-memory'], true);
    assert.ok(checks.at(-1).rects[0].height >= initialRect.height, 'completing arrangement keeps the board space');
    const saved = JSON.parse((await snapshot())[0].value); assert.deepEqual(saved.boards[dates.key()], daily);
    assert.equal(Object.keys(saved.boards).filter(id => id.startsWith('theme_')).length, 2);
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    if (mini) {
      if (backup) {
        await mini.evaluate(items => items.forEach(item => item.exists ? wx.setStorageSync(item.key, item.value) : wx.removeStorageSync(item.key)), backup);
        assert.deepEqual(await snapshot(), backup);
      }
      await mini.evaluate(() => { wx.disableAlertBeforeUnload({}); wx.reLaunch({ url: '/pages/index/index' }); });
      await mini.disconnect();
    }
  }
  const output = path.resolve(__dirname, '../artifacts/theme-board-e2e.json'); fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ passed: true, storageRestored: true, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
