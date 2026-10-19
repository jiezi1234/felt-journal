/* Native navigation acceptance. Temporarily isolates storage and restores it
 * exactly; no photos or journal entries are created. Do not edit or compile
 * the mini-program while the test is running. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1'];
const output = path.resolve(__dirname, '../artifacts');
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
(async () => {
  let mini, backup, storageRestored = false;
  const checks = [], screenshots = [], errors = [], switches = [];
  async function wait(page, predicate) {
    const started = Date.now();
    while (Date.now() - started < 15000) { const data = await page.data(); if (predicate(data)) return data; await pause(); }
    throw new Error(`Timed out on ${page.path}`);
  }
  async function route(name) {
    const started = Date.now();
    while (Date.now() - started < 15000) { const page = await mini.currentPage(); if (page && page.path === `pages/${name}/index`) { await wait(page, data => !data.loading); return page; } await pause(); }
    throw new Error(`Did not reach ${name}`);
  }
  async function nav(page, active) {
    const state = await mini.evaluate(() => {
      const page = getCurrentPages().slice(-1)[0], tab = page.getTabBar && page.getTabBar();
      const component = tab ? tab.selectComponent('#main-nav') : page.selectComponent('#main-nav');
      return component && component.data;
    });
    assert.ok(state, `${page.path} needs bottom navigation`);
    assert.equal(state.active, active); assert.equal(state.items.length, 3); return state;
  }
  async function tap(id) {
    const start = Date.now();
    await mini.evaluate(id => {
      const page = getCurrentPages().slice(-1)[0], tab = page.getTabBar && page.getTabBar();
      const component = tab ? tab.selectComponent('#main-nav') : page.selectComponent('#main-nav');
      return component.open({ currentTarget: { dataset: { id } } });
    }, id);
    switches.push({ id, automationRoundTripMs: Date.now() - start });
  }
  async function navRect() {
    return mini.evaluate(() => new Promise(resolve => {
      const page = getCurrentPages().slice(-1)[0], tab = page.getTabBar && page.getTabBar();
      const component = tab ? tab.selectComponent('#main-nav') : page.selectComponent('#main-nav');
      component.createSelectorQuery().select('.main-nav').boundingClientRect(resolve).exec();
    }));
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', error => errors.push(error)); fs.mkdirSync(output, { recursive: true });
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    const seeded = JSON.stringify({ version: 2, revision: 0, boards: {}, memories: {}, operations: {}, garbage: [], localNoticeSeen: true });
    await mini.evaluate((names, state) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], state); }, keys, seeded);
    console.log('STEP: isolated empty journal; checking fixed navigation and scroll');
    let home = await mini.reLaunch('/pages/index/index'); await wait(home, data => !data.loading);
    await nav(home, 'today'); const homeId = home.id, info = await mini.systemInfo(), first = await navRect();
    assert.ok(Math.abs(first.bottom - info.windowHeight) <= 1); assert.ok(first.height >= 64); assert.ok(first.width >= info.windowWidth - 1);
    for (const id of ['today', 'board', 'calendar']) for (const suffix of ['', '-active']) {
      const icon = await mini.callWxMethod('getImageInfo', { src: `/images/navigation/${id}${suffix}.png` }); assert.deepEqual([icon.width, icon.height], [72, 72]);
    }
    await mini.callWxMethod('pageScrollTo', { scrollTop: 10000, duration: 0 }); await home.waitFor(300);
    const scrolled = await navRect(); assert.ok(Math.abs(scrolled.top - first.top) <= 1, 'Navigation must remain fixed when the page scrolls');
    const lastButton = await mini.evaluate(() => new Promise(resolve => wx.createSelectorQuery().select('#record-today').boundingClientRect(resolve).exec()));
    assert.ok(lastButton.bottom <= scrolled.top - 4, `Last action must be above navigation: ${lastButton.bottom}/${scrolled.top}`);
    checks.push('three local icons and active labels; full-width fixed bottom bar with safe area; scroll leaves final action visible');
    const homeScroll = await home.scrollTop();
    await tap('board'); let board = await route('board-tab'); await nav(board, 'board'); const boardId = board.id;
    assert.equal((await board.data()).isTab, true); assert.equal((await board.data()).themes.length, 0); assert.equal((await mini.pageStack()).length, 1);
    await tap('board'); assert.equal((await mini.currentPage()).id, boardId); assert.equal((await mini.pageStack()).length, 1);
    await mini.evaluate(() => { getCurrentPages().slice(-1)[0].navigationTestMarker = 'retained-themes'; });
    await (await board.$('#new-theme')).tap();
    await wait(board, data => data.formOpen);
    await (await board.$('#theme-title')).input('跨日收藏'); await (await board.$('#save-theme')).tap();
    const editor = await route('board-tab'); await wait(editor, data => data.editable && !data.formOpen);
    const themeId = (await editor.data()).date;
    assert.equal(editor.id, boardId); await nav(editor, 'board'); assert.equal((await mini.pageStack()).length, 1);
    await editor.callMethod('color', { currentTarget: { dataset: { value: config.colors[1].value } } });
    await editor.callMethod('done'); board = await route('board-tab'); assert.equal(board.id, boardId); await nav(board, 'board');
    assert.equal((await board.data()).themes[0].color, config.colors[1].value);
    assert.equal((await board.data()).themes[0].title, '跨日收藏');
    checks.push('theme tab is cached; active tab is a no-op; create/edit/complete stay on the same native page with navigation visible');
    await tap('calendar'); let calendar = await route('calendar'); await nav(calendar, 'calendar'); const calendarId = calendar.id;
    assert.equal((await mini.pageStack()).length, 1); await calendar.callMethod('previous'); const historical = await calendar.data();
    await calendar.callMethod('open', { currentTarget: { dataset: { date: `${historical.year}-${String(historical.month).padStart(2, '0')}-01` } } });
    board = await route('board'); await nav(board, 'today'); assert.equal((await board.data()).canEdit, false);
    await board.callMethod('back'); calendar = await route('calendar'); await nav(calendar, 'calendar');
    assert.equal((await calendar.data()).month, historical.month); assert.equal((await calendar.data()).year, historical.year);
    if (process.env.WECHAT_NAV_SCREENSHOT === '1') {
      await mini.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 }); await calendar.waitFor(500);
      try { await mini.screenshot({ path: path.join(output, 'wechat-bottom-navigation.png') }); screenshots.push('wechat-bottom-navigation.png'); }
      catch (error) { console.warn(`Screenshot skipped: ${error.message}`); }
    }
    checks.push('calendar tab selection; historical board keeps its date and back returns to the same calendar month');
    console.log('STEP: tab routes and historical return passed; checking repeated switching and child pages');
    const ids = { index: homeId, 'board-tab': boardId, calendar: calendarId };
    for (const [id, name] of [['today', 'index'], ['calendar', 'calendar'], ['board', 'board-tab'], ['today', 'index'], ['board', 'board-tab'], ['calendar', 'calendar']]) {
      await tap(id); const page = await route(name); await nav(page, id);
      assert.equal(page.id, ids[name], `${name} must reuse its existing native page, not reload it`);
      assert.equal((await mini.pageStack()).length, 1);
      if (name === 'calendar') { assert.equal((await page.data()).month, historical.month); assert.equal((await page.data()).year, historical.year); }
      if (name === 'index') { assert.ok(Math.abs(await page.scrollTop() - homeScroll) <= 1); assert.equal((await page.data()).model.color, config.colors[0].value); assert.equal((await page.data()).count, 0); }
      if (name === 'board-tab') assert.equal(await mini.evaluate(() => getCurrentPages().slice(-1)[0].navigationTestMarker), 'retained-themes');
    }
    // Historical daily boards belong to the daily section; the theme tab remains separate.
    await calendar.callMethod('open', { currentTarget: { dataset: { date: `${historical.year}-${String(historical.month).padStart(2, '0')}-01` } } });
    board = await route('board'); await nav(board, 'today'); await tap('board'); board = await route('board-tab'); assert.equal(board.id, boardId); assert.equal((await board.data()).themes[0].id, themeId);
    await tap('calendar');
    calendar = await route('calendar'); await (await calendar.$('#find-memories')).tap(); const memories = await route('memories'); assert.equal(await memories.$('#main-nav'), null);
    await memories.callMethod('back'); calendar = await route('calendar'); await nav(calendar, 'calendar');
    const snapshot = JSON.parse(await mini.callWxMethod('getStorageSync', keys[0]));
    assert.equal(Object.keys(snapshot.memories).length, 0); assert.deepEqual(Object.keys(snapshot.boards), [themeId]);
    assert.equal(snapshot.revision, 3, 'Only creation, the color edit and finishing the arrangement save journal data');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    checks.push('repeated tab switches retain native page IDs, theme list, home scroll and calendar month; stack depth one; daily and theme data remain independent');
  } finally {
    if (mini) {
      if (backup) {
        await mini.evaluate(items => items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)), backup);
        assert.deepEqual(await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys), backup); storageRestored = true;
      }
      await mini.reLaunch('/pages/index/index').catch(() => {}); mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output, 'wechat-navigation-e2e.json'), JSON.stringify({ passed: true, recordedAt: new Date().toISOString(), storageRestored, checks, switches, screenshots,
    limitations: ['WeChat DevTools with isolated empty journal', 'Phone safe area and physical touch need device acceptance'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
