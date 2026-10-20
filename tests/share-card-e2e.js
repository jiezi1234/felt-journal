// Read-only native acceptance: never replace storage, edit records or send images.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const output = path.resolve(__dirname, '../artifacts/share-card');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let mini, before, initialUrl, calendarMonth;
  const mocked = [], checks = [], skipped = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
  async function wait(target, predicate) {
    for (let i = 0; i < 150; i++) { const data = await target.data(); if (predicate(data)) return data; await pause(100); }
    throw Error('Share card did not settle');
  }
  async function route(url, method = 'switchTab') {
    await mini.evaluate((url, method) => new Promise((resolve, reject) => wx[method]({ url, success: () => resolve(true), fail: e => reject(Error(e.errMsg)) })), url, method);
    await pause(500); const p = await mini.currentPage(); await wait(p, d => !d.loading); return p;
  }
  async function exercise(name, owner, trigger, boardSelector, chain = [], withActions = false) {
    const original = await owner.data();
    assert.ok(!original.shareBoardId && !original.drawer && !original.memoryCardId, 'Leave existing cards untouched');
    if (!original.count) { skipped.push(name + ': no existing objects'); return; }
    const current = await mini.currentPage(), depth = (await mini.pageStack()).length;
    await (await owner.$(trigger)).tap(); await wait(owner, d => !!d.shareBoardId);
    const card = await owner.$('#share-card'); let data = await wait(card, d => !d.generating);
    assert.equal((await mini.currentPage()).id, current.id); assert.equal((await mini.pageStack()).length, depth);
    const board = await owner.$(boardSelector); await wait(board, d => d.covered && !!d.snapshot);
    const bounds = await mini.evaluate(chain => new Promise(resolve => {
      let owner = getCurrentPages().slice(-1)[0]; for (const selector of chain) owner = owner.selectComponent(selector);
      const card = owner.selectComponent('#share-card');
      card.createSelectorQuery().select('.share-card-dialog').boundingClientRect().select('#close-share-card').boundingClientRect().select('.share-card-preview').boundingClientRect().exec(rects => resolve({ rects, height: wx.getWindowInfo().windowHeight }));
    }), chain);
    for (const r of bounds.rects) assert.ok(r && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= bounds.height, name + ' fits the screen');
    await pause(300); await mini.screenshot({ path: path.join(output, name + '.png') });
    if (!data.error) {
      const info = await mini.callWxMethod('getImageInfo', { src: data.imagePath }), frame = (await owner.data()).shareViewport;
      assert.ok(frame && frame.width > 0 && frame.height > 0);
      assert.equal(Math.max(info.width, info.height), 1800);
      assert.ok(Math.abs(info.width / info.height - frame.width / frame.height) < 0.001, name + ' preserves source aspect ratio');
    }
    if (withActions) {
      assert.equal(data.error, ''); assert.ok(data.imagePath);
      const info = await mini.callWxMethod('getImageInfo', { src: data.imagePath });
      const frame = (await owner.data()).shareViewport;
      assert.ok(frame && frame.width > 0 && frame.height > 0);
      assert.equal(Math.max(info.width, info.height), 1800);
      assert.ok(Math.abs(info.width / info.height - frame.width / frame.height) < 0.001, 'Share keeps the originating canvas aspect ratio');
      await (await card.$('#share-appearance')).tap(); await wait(card, d => d.styleOpen);
      const value = data.colors.find(c => c.value !== data.previewColor).value;
      await card.callMethod('chooseColor', { currentTarget: { dataset: { value } } });
      data = await wait(card, d => !d.generating && d.previewColor === value); assert.equal(data.error, '');
      await (await card.$('#share-texture-cross')).tap(); data = await wait(card, d => !d.generating && d.previewTexture === 'cross');
      await mini.screenshot({ path: path.join(output, 'appearance.png') });
      await (await card.$('#close-share-style')).tap(); await wait(card, d => !d.styleOpen); await pause(250);
      await (await card.$('#share-image')).tap();
      for (let i = 0; i < 50; i++) { if (await mini.evaluate(() => !!getApp().__shareCardAcceptance.share)) break; await pause(100); }
      await wait(card, d => !d.sharing);
      assert.deepEqual(await mini.evaluate(() => getApp().__shareCardAcceptance.share), { path: data.imagePath, needShowEntrance: false });
      assert.equal((await card.data()).albumSaved, false);
      await (await card.$('#save-album')).tap(); await wait(card, d => d.albumSaved);
      assert.equal(await mini.evaluate(() => getApp().__shareCardAcceptance.album), data.imagePath);
      checks.push('Real export preserves originating board aspect ratio; appearance and mocked share/album callbacks preserve saved records');
    } else if (data.error) {
      assert.ok(await card.$('#regenerate-image')); assert.equal(data.imagePath, '');
      checks.push(name + ': unavailable existing photo is shown as a retryable error inside the card');
    }
    await (await card.$('#close-share-card')).tap(); await wait(owner, d => !d.shareBoardId); await wait(board, d => !d.covered);
    const after = await owner.data();
    for (const key of ['date', 'selected', 'editable', 'model', 'canUndo', 'canRedo']) assert.deepEqual(after[key], original[key], name + ' retains ' + key);
    assert.equal((await mini.currentPage()).id, current.id); assert.equal((await mini.pageStack()).length, depth);
    assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'Records and configuration must remain unchanged');
    checks.push(name + ': opens and closes on the same page, covers the canvas and retains board state');
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    before = await snapshot(); fs.mkdirSync(output, { recursive: true });
    initialUrl = await mini.evaluate(() => {
      const pages = getCurrentPages();
      for (const p of pages) if (p.dirty || p.noteDirty || p.photoTask || p.mutating || p.data.editorOpen || p.data.memoryCardId || p.data.boardDate || p.data.shareBoardId || p.data.drawer || p.data.formOpen) throw Error('Finish current work before read-only acceptance');
      const store = require('core/store.js').getStore();
      if (Object.values(store.get().boards).some(b => store.getDraft(b.id || b.date))) throw Error('Resolve layout drafts before read-only acceptance');
      const p = pages[pages.length - 1];
      if (!['pages/index/index', 'pages/board-tab/index', 'pages/calendar/index'].includes(p.route)) throw Error('Start from an idle tab');
      getApp().__shareCardAcceptance = {};
      return '/' + p.route;
    });
    await mini.mockWxMethod('showShareImageMenu', options => { getApp().__shareCardAcceptance.share = { path: options.path, needShowEntrance: options.needShowEntrance }; return { errMsg: 'showShareImageMenu:ok' }; }); mocked.push('showShareImageMenu');
    await mini.mockWxMethod('saveImageToPhotosAlbum', options => { getApp().__shareCardAcceptance.album = options.filePath; return { errMsg: 'saveImageToPhotosAlbum:ok' }; }); mocked.push('saveImageToPhotosAlbum');
    const home = await route('/pages/index/index');
    const date = await mini.evaluate(() => {
      const store = require('core/store.js').getStore();
      return Object.values(store.get().boards).filter(b => b.type !== 'theme' && b.placements.length).map(b => b.date).sort().pop() || getCurrentPages().slice(-1)[0].data.date;
    });
    const homeHasItems = !!(await home.data()).count;
    if (homeHasItems) {
      await home.callMethod('editItem', { detail: { id: (await home.data()).model.items[0].memoryId } });
      await exercise('today', home, '#export-today', '#today-board', [], true);
    } else skipped.push('Today has no existing objects for successful export');
    const theme = await route('/pages/board-tab/index');
    await exercise('theme', theme, '#share-theme', '#board', [], !homeHasItems);
    const calendar = await route('/pages/calendar/index');
    calendarMonth = { year: (await calendar.data()).year, month: (await calendar.data()).month };
    await calendar.callMethod('open', { currentTarget: { dataset: { date } } });
    await wait(calendar, d => d.boardDate === date);
    const day = await calendar.$('#day-board-card'); await wait(day, d => !d.loading);
    await exercise('calendar', day, '#share-day-board', '#board', ['#day-board-card']);
    assert.equal((await calendar.data()).boardDate, date);
    await (await day.$('#close-day-board')).tap(); await wait(calendar, d => !d.boardDate);
    assert.deepEqual({ year: (await calendar.data()).year, month: (await calendar.data()).month }, calendarMonth);
    const board = await route('/pages/board/index?date=' + date, 'navigateTo');
    await exercise('board', board, '#export-board', '#board');
  } finally {
    if (mini) {
      try {
        for (const method of mocked) await mini.restoreWxMethod(method);
        await mini.evaluate(() => {
          const p = getCurrentPages().slice(-1)[0], day = p.selectComponent('#day-board-card'), owner = day || p;
          const share = owner.selectComponent('#share-card'); if (share) share.close();
          if (day && !day.data.shareBoardId) day.close();
          delete getApp().__shareCardAcceptance;
        });
        if (initialUrl) await route(initialUrl);
        if (before) assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'Acceptance changed stored records or configuration');
      } finally { mini.disconnect(); }
    }
  }
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: true, readOnly: true, checks, skipped, limitations: ['Sharing and album APIs mocked; actual sending and real-device compatibility not tested'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: ')); if (skipped.length) console.log('SKIPPED:', skipped.join('; '));
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
