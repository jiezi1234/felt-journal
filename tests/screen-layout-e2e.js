const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve(__dirname, '../artifacts/screen-layout-e2e.json');
(async () => {
  let mini, backup;
  const checks = [];
  async function call(method, argument, component = '') {
    await mini.evaluate((method, argument, component) => {
      const page = getCurrentPages().slice(-1)[0], target = component ? page.selectComponent(component) : page;
      return target[method](argument);
    }, method, argument, component);
    await pause(450);
  }
  async function route(url, tab = false) {
    await mini.evaluate((url, tab) => new Promise((resolve, reject) => wx[tab ? 'switchTab' : 'navigateTo']({ url, success: resolve, fail: reject })), url, tab);
    await pause(350);
  }
  async function inspect(name, selectors, component = '') {
    for (let attempt = 0; attempt < 40; attempt++) {
      const ready = await mini.evaluate((selector, component) => new Promise(resolve => {
        const p = getCurrentPages().slice(-1)[0], c = component && p && p.selectComponent(component);
        if (!p || component && !c) return resolve(false);
        (c ? c.createSelectorQuery() : wx.createSelectorQuery()).select(selector).boundingClientRect(r => resolve(!!r && r.height > 0)).exec();
      }), selectors[0], component);
      if (ready) break; await pause(200);
    }
    const result = await mini.evaluate((selectors, component) => new Promise(resolve => {
      const p = getCurrentPages().slice(-1)[0], target = component ? p.selectComponent(component) : null;
      const q = target ? target.createSelectorQuery() : wx.createSelectorQuery();
      q.selectAll('button').boundingClientRect();
      selectors.forEach(selector => q.select(selector).boundingClientRect());
      q.exec(values => resolve({ route: p.route, viewport: wx.getSystemInfoSync().windowHeight, buttons: values[0], rects: values.slice(1), error: (target || p).data.error || '' }));
    }), selectors, component);
    assert.equal(result.error, '', name + ' error');
    for (const rect of result.buttons.filter(r => r.height && r.width)) {
      assert.ok(rect.top >= -1 && rect.bottom <= result.viewport + 1, name + ' button outside viewport: ' + JSON.stringify(rect));
    }
    for (let i = 0; i < selectors.length; i++) {
      const rect = result.rects[i];
      assert.ok(rect && rect.height > 0 && rect.width > 0, name + ' missing: ' + selectors[i] + ' ' + JSON.stringify(result));
      assert.ok(rect.top >= -1 && rect.bottom <= result.viewport + 1, name + ' outside viewport: ' + selectors[i] + JSON.stringify(rect));
    }
    if (!component) {
      await mini.evaluate(() => wx.pageScrollTo({ scrollTop: 10000, duration: 0 }));
      await pause(80);
      const scrollTop = await mini.evaluate(() => new Promise(resolve => wx.createSelectorQuery().selectViewport().scrollOffset(r => resolve(r.scrollTop)).exec()));
      assert.ok(scrollTop <= 1, name + ' page requires scrolling: ' + scrollTop);
    }
    checks.push({ name, ...result });
    console.log('PASS:', name);
    return result;
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const today = dates.key(), photo = { originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72, kind: 'original' };
    const ids = [];
    for (let i = 0; i < 9; i++) { const id = store.add('fit_' + i, today, photo); store.edit(id, '记忆文字'.repeat(40), '饮食'); ids.push(id); }
    for (let i = 0; i < 5; i++) store.createTheme('fit_' + i, '用于检查标题换行的主题板'.repeat(2), ids[0]);
    store.commit(state => { state.localNoticeSeen = true; });
    await mini.evaluate((keys, value) => { keys.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(keys[0], value); }, keys, disk[keys[0]]);
    await mini.evaluate(() => wx.reLaunch({ url: '/pages/index/index' })); await pause(700);
    const home = await inspect('today', ['.today-stage', '#record-today', '#arrange-today']);
    assert.ok(home.rects[0].height > home.rects[0].width, 'home board should use the portrait space');
    assert.equal(home.rects[1].width, 56); assert.equal(home.rects[1].height, 56);
    assert.equal(await mini.evaluate(() => new Promise(resolve => wx.createSelectorQuery().select('#find-memories').boundingClientRect(resolve).exec())), null);
    await call('primary'); await pause(1200); await inspect('record source card', ['#record-camera', '#record-album'], '#record-card');
    await call('showBoard', undefined, '#record-card');
    await call('select', { detail: { id: ids[0] } }, '#record-card');
    await inspect('record selected editor', ['.editor-stage', '#finish-record', '#remove-placement'], '#record-card');
    await call('openAppearance', undefined, '#record-card'); await inspect('appearance drawer', ['.drawer-sheet', '.textures'], '#record-card');
    await call('closeDrawer', undefined, '#record-card'); await call('back', undefined, '#record-card');
    await route('/pages/calendar/index', true);
    await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; p.year = 2026; p.month = 8; p.refresh(); }); await pause(200);
    await inspect('six-week calendar', ['.calendar-paper', '#find-memories', '#find-month-memories']);
    assert.equal(await mini.evaluate(() => getCurrentPages().slice(-1)[0].data.cells.length), 42);
    await call('categories'); await inspect('four-memory page', ['.memory-grid', '#next-page']);
    const seen = [];
    for (let page = 1; page <= 3; page++) {
      const d = await mini.evaluate(() => getCurrentPages().slice(-1)[0].data);
      seen.push(...d.groups.flatMap(g => g.items.map(m => m.id))); if (page < 3) await call('next');
    }
    assert.equal(new Set(seen).size, 9);
    await call('scope', { currentTarget: { dataset: { scope: 'month' } } }); await inspect('month filters', ['#month-picker', '.memory-grid', '#next-page']);
    await call('back'); await route('/pages/board-tab/index', true);
    await inspect('theme page', ['.theme-card', '#next-theme']);
    await call('next'); assert.equal(await mini.evaluate(() => getCurrentPages().slice(-1)[0].data.page), 2);
    await call('create'); await inspect('theme name drawer', ['.theme-form', '#save-theme']); await call('cancelForm');
    await route('/pages/memory/index?id=' + ids[0]);
    await inspect('memory subject', ['.memory-paper', '#add-to-theme', '#adjust-image']);
    await call('section', { currentTarget: { dataset: { section: 'original' } } }); await inspect('memory original', ['.detail-image', '#delete-memory']);
    await call('edit'); await inspect('memory text editor', ['.note-input', '.category-picker', '#delete-memory']);
    await call('adjust'); await pause(250); await inspect('photo crop', ['.crop-stage', '#save-image', '#reset-image']);
    await call('back'); await call('back');
    await route('/pages/board/index?date=' + today + '&mode=edit');
    await call('select', { detail: { id: ids[0] } }); await inspect('full board editor', ['.editor-stage', '#remove-placement', '#add-from-library']);
    await call('done'); await inspect('board view', ['.editor-stage', '#export-board']);
    await call('exportBoard'); await pause(900); await inspect('export', ['.export-paper', '#save-album', '#share-image']);
  } finally {
    if (mini) {
      if (backup) {
        await mini.evaluate(items => items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)), backup);
        assert.deepEqual(await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys), backup);
      }
      await mini.evaluate(() => { wx.disableAlertBeforeUnload({}); wx.reLaunch({ url: '/pages/index/index' }); }).catch(() => {});
      mini.disconnect();
    }
  }
  fs.writeFileSync(output, JSON.stringify({ passed: true, storageRestored: true, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
