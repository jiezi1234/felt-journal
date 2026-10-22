// Simulator-only acceptance. All journal writes use an in-memory store;
// packaged icons stand in for photos and actual storage is checked unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve('artifacts/theme-board-interaction');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:active-theme:v1'];
(async () => {
  let mini, before, installed = false;
  const checks = [], errors = [];
  const snapshot = () => mini.evaluate(keys => keys.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
  const state = () => mini.evaluate(() => getCurrentPages().slice(-1)[0].data);
  const call = (method, arg) => mini.evaluate((method, arg) => getCurrentPages().slice(-1)[0][method](arg), method, arg);
  async function until(predicate, label) {
    for (let i = 0; i < 80; i++) { const value = await predicate(); if (value) return value; await pause(80); }
    throw Error('Timed out: ' + label);
  }
  function passed(label) { checks.push(label); console.log('PASS:', label); }
  async function rects(selectors) {
    return mini.evaluate(selectors => Promise.all(selectors.map(selector => new Promise(resolve => {
      const p = getCurrentPages().slice(-1)[0];
      const host = /^#(add-theme-memory|theme-(undo|view-memory|layer-front|remove-placement))$/.test(selector) ? p.selectComponent('#board') : p;
      host.createSelectorQuery().select(selector).boundingClientRect(resolve).exec();
    }))).then(rects => ({ rects, height: wx.getWindowInfo().windowHeight, width: wx.getWindowInfo().windowWidth })), selectors);
  }
  async function tap(selector) {
    const page = await mini.currentPage();
    if (/^#(add-theme-memory|theme-(undo|view-memory|layer-front|remove-placement))$/.test(selector)) {
      // Native canvas touch must reach the action even if it covers the DOM hit target.
      await until(() => mini.evaluate(id => {
        const b = getCurrentPages().slice(-1)[0].selectComponent('#board');
        return b && !b.data.covered && !b.data.canvasHidden && b.data.actions.some(a => '#' + a.id === id);
      }, selector), selector + ' live canvas ready');
      const [r] = (await rects([selector])).rects, touch = { identifier: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      const canvas = await (await page.$('#board')).$('#feltCanvas');
      await canvas.touchstart({ touches: [touch], changedTouches: [touch] });
      await canvas.touchend({ touches: [], changedTouches: [touch] });
    } else await (await until(() => page.$(selector), selector + ' mounted')).tap();
    await pause(180);
  }
  async function visibleAdd() {
    const color = await mini.evaluate(() => {
      const b = getCurrentPages().slice(-1)[0].selectComponent('#board'), a = b.data.actions.find(a => a.action === 'add');
      if (!a) return null;
      const scale = b.canvas.width / b.screenWidth;
      return Array.from(b.canvas.getContext('2d').getImageData(Math.round((a.x + 12) * scale), Math.round((a.y + 25 + b.data.topSpace) * scale), 1, 1).data);
    });
    assert.ok(color && color[3] > 240 && color.slice(0, 3).every(v => v < 70), 'FAB is actually painted above the felt: ' + color);
  }
  async function swipe(dx, dy = 0, fromObject = false) {
    await until(() => mini.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0], b = p.selectComponent('#board');
      return b && b.displayModel && b.displayModel.id === p.date && !b.data.covered && !b.data.canvasHidden;
    }), 'swipe board paint ready');
    const touch = await mini.evaluate(fromObject => new Promise(resolve => {
      const b = getCurrentPages().slice(-1)[0].selectComponent('#board');
      b.createSelectorQuery().select('.board-shell').boundingClientRect(r => {
        const p = fromObject && b.displayModel.items.at(-1), scale = b.screenWidth / 1500;
        if (fromObject && !p) { resolve(null); return; }
        resolve({ identifier: 0, clientX: r.left + (p ? (p.x + 45) * scale : r.width / 2), clientY: r.top + (p ? (p.y + 45) * scale : r.height * .66) });
      }).exec();
    }), fromObject);
    assert.ok(touch, 'Swipe fixture must contain an object');
    const canvas = await (await (await mini.currentPage()).$('#board')).$('#feltCanvas');
    const moved = { ...touch, clientX: touch.clientX + dx, clientY: touch.clientY + dy };
    await canvas.touchstart({ touches: [touch], changedTouches: [touch] });
    await canvas.touchmove({ touches: [moved], changedTouches: [moved] });
    await canvas.touchend({ touches: [], changedTouches: [moved] });
    await pause(220);
  }
  async function inView(selectors) {
    const result = await rects(selectors);
    for (const r of result.rects) assert.ok(r && r.width > 0 && r.height > 0 && r.left >= -1 && r.right <= result.width + 1 && r.top >= -1 && r.bottom <= result.height + 1, 'Control fits viewport: ' + JSON.stringify(r));
    return result.rects;
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    assert.ok(await mini.evaluate(() => !!getApp() && !!getCurrentPages().length), 'Wait for the simulator to finish compiling');
    console.log('STEP: simulator ready');
    mini.on('exception', error => errors.push(error)); fs.mkdirSync(output, { recursive: true }); before = await snapshot();
    await mini.evaluate(() => {
      if (wx.getSystemInfoSync().platform !== 'devtools') throw Error('Simulator only');
      for (const p of getCurrentPages()) if (p.dirty || p.noteDirty || p.photoTask || p.data.memoryCardId || p.data.shareBoardId) throw Error('Finish editing first');
      if (typeof require('services/theme-board-page.js').createThemeBoardPage().addLibrary !== 'function') throw Error('Compile the updated project first');
    });
    await mini.callWxMethod('switchTab', { url: '/pages/index/index' }); await pause(200);
    const fixture = await mini.evaluate(() => {
      const module = require('core/store.js'), store = module.getStore(), disk = {}, original = { ...store };
      const isolated = module.createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
      const ids = [];
      for (let i = 0; i < 12; i++) {
        const id = isolated.add('theme_ui_' + i, i % 2 ? '2024-01-01' : require('core/date.js').key(), {
          originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72
        });
        isolated.edit(id, i % 2 ? '公园里的一片叶子' : '下午的一杯咖啡', i % 2 ? '自然' : '饮食'); ids.push(id);
      }
      const first = isolated.createTheme('ui_first', '秋日散步'), second = isolated.createTheme('ui_second', '喝过的咖啡');
      isolated.placeMany(ids.slice(0, 3), first); isolated.rememberTheme(first);
      isolated.commit(s => { s.localNoticeSeen = true; s.boardGuideSeen = true; });
      getApp().__themeUI = { original, daily: isolated.board(require('core/date.js').key()), first, second, ids };
      Object.assign(store, isolated); return { first, second, ids };
    }); installed = true;
    console.log('STEP: isolated fixtures ready');
    await mini.reLaunch('/pages/board-tab/index');
    await until(async () => { const s = await state(); return !s.loading && s.date === fixture.first; }, 'theme ready');
    await until(() => mini.evaluate(() => { const b = getCurrentPages().slice(-1)[0].selectComponent('#board'); return b && b.canvas && b.displayModel; }), 'canvas ready');
    const [stage, fab] = await inView(['.theme-stage', '#add-theme-memory', '#switch-theme', '#theme-options']);
    assert.ok(fab.width >= 44 && fab.width <= 52 && Math.abs(fab.height - fab.width) <= 1);
    assert.ok(Math.abs(fab.right - stage.right) <= 13, 'Add stays at the board right edge');
    assert.ok(fab.top > stage.top && fab.bottom <= stage.bottom + 8);
    const page = await mini.currentPage(); assert.equal(await page.$('#finish-theme'), null); assert.equal(await page.$('#next-theme'), null);
    await visibleAdd();
    passed('board opens directly with a 50px floating add button and no arrangement or pagination row');
    await mini.screenshot({ path: path.join(output, 'board.png') });
    const order = (await state()).themes.map(b => b.id);
    await call('open', { currentTarget: { dataset: { id: order[0] } } });
    await swipe(-100); await until(async () => (await state()).date === order[1], 'left swipe changes board');
    await swipe(-100); assert.equal((await state()).date, order[1], 'Last board stays in place');
    await swipe(100); await until(async () => (await state()).date === order[0], 'right swipe changes board');
    assert.equal((await state()).memoryCardId, '');
    await swipe(100); assert.equal((await state()).date, order[0], 'First board stays in place');
    await swipe(-25); await swipe(0, 100); await swipe(-90, 90);
    assert.equal((await state()).date, order[0], 'Short, vertical and diagonal gestures do not switch');
    await call('open', { currentTarget: { dataset: { id: fixture.first } } });
    await swipe(order.indexOf(fixture.first) ? 100 : -100, 0, true);
    await until(async () => (await state()).date === fixture.second, 'quick swipe over an object changes board');
    assert.equal((await state()).memoryCardId, '');
    await call('open', { currentTarget: { dataset: { id: fixture.first } } });
    passed('left/right native swipes follow theme order, work over objects and stop at boundaries without accidental card opens');
    await tap('#switch-theme'); assert.equal((await state()).drawer, 'themes');
    await inView(['.drawer-sheet', '.theme-thumbnail']);
    await mini.screenshot({ path: path.join(output, 'theme-picker.png') });
    await call('open', { currentTarget: { dataset: { id: fixture.second } } });
    assert.equal((await state()).date, fixture.second); assert.equal((await state()).editable, false);
    await mini.reLaunch('/pages/board-tab/index'); assert.equal((await state()).date, fixture.second);
    passed('thumbnail picker switches boards and a fresh page restores the last board');
    await tap('#add-theme-memory'); assert.equal((await state()).drawer, 'library');
    await inView(['#theme-library-search', '.theme-memory', '#theme-new-photo', '#add-library-selection']);
    assert.equal((await state()).visibleLibraryItems.length, 12);
    await tap('.theme-memory'); assert.equal((await state()).librarySelected.length, 1);
    await call('searchLibrary', { detail: { value: '咖啡' } }); assert.equal((await state()).visibleLibraryItems.length, 6);
    await call('categoryLibrary', { currentTarget: { dataset: { category: '自然' } } }); assert.equal((await state()).visibleLibraryItems.length, 0);
    await call('searchLibrary', { detail: { value: '' } });
    assert.equal((await state()).visibleLibraryItems.length, 6); assert.equal((await state()).librarySelected.length, 1);
    const choosing = await state(), pick = choosing.visibleLibraryItems.find(m => !choosing.librarySelected.includes(m.id));
    await call('toggleLibrary', { currentTarget: { dataset: { id: pick.id } } });
    await mini.screenshot({ path: path.join(output, 'memory-picker.png') });
    const selection = (await state()).librarySelected.length; assert.ok(selection >= 2);
    await tap('#add-library-selection'); assert.equal((await state()).count, selection); assert.equal((await state()).drawer, '');
    passed('search and category filters preserve multiple choices, then add them together');
    await call('clearSelection');
    const board = await (await mini.currentPage()).$('#board'), canvas = await board.$('#feltCanvas');
    const touch = await mini.evaluate(() => new Promise(resolve => {
      const b = getCurrentPages().slice(-1)[0].selectComponent('#board');
      b.createSelectorQuery().select('.board-shell').boundingClientRect(r => { const p = b.displayModel.items.slice(-1)[0]; resolve({ identifier: 0, clientX: r.left + (p.x + 45) * b.screenWidth / 1500, clientY: r.top + (p.y + 45) * b.screenWidth / 1500 }); }).exec();
    }));
    const original = JSON.stringify((await state()).model.placements);
    await canvas.touchstart({ touches: [touch], changedTouches: [touch] });
    await until(async () => !!(await state()).selected, 'long press selection');
    await inView(['#theme-undo', '#theme-view-memory', '#theme-remove-placement']);
    const moved = { ...touch, clientX: touch.clientX + 80, clientY: touch.clientY - 12 };
    await canvas.touchmove({ touches: [moved], changedTouches: [moved] });
    await until(async () => (await state()).dragging, 'drag hides floating controls');
    await until(() => mini.evaluate(() => !getCurrentPages().slice(-1)[0].selectComponent('#board').data.actions.length), 'native controls hidden');
    await canvas.touchend({ touches: [], changedTouches: [moved] });
    await until(async () => !(await state()).dragging, 'drop restores controls');
    await until(() => mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#board').data.actions.length === 5), 'native controls restored');
    await visibleAdd();
    await mini.screenshot({ path: path.join(output, 'selected.png') });
    assert.notEqual(JSON.stringify((await state()).model.placements), original);
    assert.equal((await state()).date, fixture.second, 'A horizontal long-press drag cannot switch boards');
    assert.equal((await state()).saveError, '');
    assert.equal((await rects(['.theme-stage'])).rects[0].height, stage.height);
    passed('native canvas long press drags directly; floating controls hide during movement without resizing the board');
    await tap('#theme-view-memory');
    await until(() => mini.evaluate(() => { const c = getCurrentPages().slice(-1)[0].selectComponent('#memory-card'); return c && !c.data.pickupBusy; }), 'memory card opens');
    await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#memory-card').close());
    await until(async () => !(await state()).memoryCardId, 'memory returns');
    passed('memory card pickup and return still work on the taller board');
    await tap('#theme-options'); await inView(['#share-theme', '#rename-theme', '#theme-appearance', '#delete-theme']);
    await tap('#theme-appearance'); await until(async () => (await state()).drawer === 'appearance', 'appearance menu');
    await inView(['.colors', '.textures']);
    await call('color', { currentTarget: { dataset: { value: '#C3D0BD' } } }); await call('closeDrawer');
    assert.equal((await state()).model.color, '#C3D0BD');
    passed('theme management and material controls are reachable from the options menu');
    await tap('#switch-theme'); await tap('#new-theme');
    await until(async () => (await state()).formOpen, 'new theme form');
    await call('input', { detail: { value: '旅行小纪念' } }); await tap('#save-theme');
    await until(async () => (await state()).drawer === 'library', 'new theme memory picker');
    assert.equal((await state()).drawer, 'library'); assert.equal((await state()).count, 0);
    await tap('#close-drawer'); assert.equal((await state()).editable, false);
    await tap('#add-theme-memory');
    await until(async () => (await state()).drawer === 'library', 'floating add opens library');
    await tap('#theme-new-photo');
    await inView(['#source-camera', '#source-album']); await call('closeDrawer');
    assert.equal((await state()).editable, false);
    passed('creation offers memories immediately; skipping or canceling returns to browsing, with camera and album accessible');
    assert.equal(await mini.evaluate(() => JSON.stringify(require('core/store.js').getStore().board(require('core/date.js').key()))), await mini.evaluate(() => JSON.stringify(getApp().__themeUI.daily)));
    assert.deepEqual(await snapshot(), before); assert.equal(errors.length, 0, JSON.stringify(errors));
  } catch (error) {
    if (installed) {
      const s = await state();
      console.error('Acceptance state:', JSON.stringify({ drawer: s.drawer, formOpen: s.formOpen, formError: s.formError, working: s.working, title: s.title, date: s.date, count: s.count, error: s.error }));
      console.error('Canvas state:', await mini.evaluate(() => { const b = getCurrentPages().slice(-1)[0].selectComponent('#board'); return b && { covered: b.data.covered, hidden: b.data.canvasHidden, snapshot: b.data.snapshotVisible, actions: b.data.actions, show: b.data.showActions }; }));
      await mini.screenshot({ path: path.join(output, 'failure.png') });
    }
    throw error;
  } finally {
    if (mini) {
      if (installed) {
        await call('clearSelection'); await call('closeDrawer');
        await mini.callWxMethod('switchTab', { url: '/pages/index/index' });
        await mini.evaluate(() => { const q = getApp().__themeUI; Object.assign(require('core/store.js').getStore(), q.original); delete getApp().__themeUI; const p = getCurrentPages().slice(-1)[0]; p.history = null; p.dirty = false; p.refresh(); });
      }
      if (before) assert.deepEqual(await snapshot(), before);
      await mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ passed: true, storageUnchanged: true, checks, errors }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
