// Exercises Canvas touch bindings, not just DOM button taps. All journal writes
// go to a temporary in-memory adapter; actual device storage is never replaced.
// Compile in DevTools before running; reLaunch alone does not reload imports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const dragControl = require('./helpers/drag-control');
const output = path.resolve('artifacts/board-controls');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const difference = (op, actual, expected) => op === 'rotate' ? Math.abs(((actual - expected + 540) % 360) - 180) : Math.abs(actual - expected);

(async () => {
  let mini, before, originalRoute, installed = false, modalMocked = false;
  const checks = [], errors = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
  async function wait(target, predicate, label) {
    for (let n = 0; n < 100; n++) { const data = await target.data(); if (predicate(data)) return data; await pause(100); }
    const data = await target.data();
    throw Error('Timed out: ' + label + ' ' + JSON.stringify({ loading: data.loading, count: data.count, error: data.error, selected: data.selected, editable: data.editable, imageError: data.imageError }));
  }
  const state = () => mini.evaluate(() => require('core/store.js').getStore().get());
  async function touchAt(selector, id, op) {
    return mini.evaluate((selector, id, op) => new Promise(resolve => {
      const board = getCurrentPages().slice(-1)[0].selectComponent(selector);
      board.createSelectorQuery().select('#feltCanvas').boundingClientRect(rect => {
        const item = board.displayModel.items.find(p => p.memoryId === id);
        const handle = op && board.data.handles.find(h => h.op === op);
        const x = handle ? handle.x : (item.x + 45) * board.screenWidth / 1500;
        const y = handle ? handle.y : (item.y + 45) * board.screenWidth / 1500;
        resolve({ identifier: 0, clientX: rect.left + x, clientY: rect.top + y });
      }).exec();
    }), selector, id, op);
  }
  async function press(board, selector, id, op, duration = 70) {
    const canvas = await board.$('#feltCanvas'), touch = await touchAt(selector, id, op);
    await canvas.touchstart({ touches: [touch], changedTouches: [touch] });
    await pause(duration);
    // Hidden DevTools windows throttle timers; do not release a held gesture
    // until its long-press has actually fired. Unit tests check the 650ms bound.
    if (!op && duration > 650) {
      let held = false;
      for (let n = 0; n < 60; n++) {
        held = await mini.evaluate(selector => {
          const g = getCurrentPages().slice(-1)[0].selectComponent(selector).gesture;
          return !!(g && g.long);
        }, selector);
        if (held) break; await pause(50);
      }
      assert.ok(held, 'Long press must fire before release');
    }
    if (op) {
      const detected = await mini.evaluate(selector => {
        const g = getCurrentPages().slice(-1)[0].selectComponent(selector).gesture;
        return g && g.control;
      }, selector);
      assert.equal(detected, op, 'Canvas binding must resolve the visible control before release');
    }
    await canvas.touchend({ touches: [], changedTouches: [touch] });
  }
  async function pressOverlay(board, selector, id, op) {
    const button = await board.$('.grip[data-op="' + op + '"]');
    const touch = await touchAt(selector, id, op);
    await button.touchstart({ touches: [touch], changedTouches: [touch] }); await pause(60);
    const g = await mini.evaluate(selector => {
      const g = getCurrentPages().slice(-1)[0].selectComponent(selector).gesture;
      return g && { op: g.control, button: g.button };
    }, selector);
    assert.deepEqual(g, { op, button: true }, 'The overlay must handle its own physical touch sequence');
    await button.touchend({ touches: [], changedTouches: [touch] });
    // Some runtimes emit a later tap, others don't. Neither may double-apply.
    if (op !== 'remove') {
      const beforeTap = JSON.stringify(await state());
      await button.tap(); assert.equal(JSON.stringify(await state()), beforeTap, 'Synthetic tap must not duplicate touchend');
    }
  }
  async function exercise(selector, name) {
    const page = await mini.currentPage(); await wait(page, d => !d.loading && d.count === 2, name + ' board');
    const board = await page.$(selector); await wait(board, d => d.width > 0 && !d.covered && !d.imageError, 'canvas');
    const initial = (await page.data()).model.items[0], other = (await page.data()).model.items[1], id = initial.memoryId;
    await press(board, selector, id, null, 850);
    await wait(page, d => d.editable && d.selected === id && !d.memoryCardId, 'long press');
    await wait(board, d => d.handles.length === 3, 'controls');
    const placement = d => d.model.items.find(p => p.memoryId === id);
    async function drag(op, value, canvas = false, cancel = false) {
      const original = placement(await page.data()), stored = JSON.stringify(await state());
      let previousGrip;
      const node = await dragControl(mini, board, selector, op, value, { canvas, cancel, onMove: async (fraction, touch) => {
        const preview = await mini.evaluate(selector => {
          const b = getCurrentPages().slice(-1)[0].selectComponent(selector);
          return b.dragModel && b.dragModel.items.find(p => p.memoryId === b.data.selected);
        }, selector);
        assert.ok(preview, 'A live preview must exist while holding');
        const expected = op === 'resize' ? original.width * (1 + (value - 1) * fraction) : ((original.angle + value * fraction) % 360 + 360) % 360;
        const actual = op === 'resize' ? preview.width : preview.angle;
        assert.ok(difference(op, actual, expected) < .01, `Preview must follow intermediate finger positions: ${op}, fraction=${fraction}, actual=${actual}, expected=${expected}`);
        if (op === 'rotate') {
          const position = await mini.evaluate(selector => new Promise(resolve => {
            const b = getCurrentPages().slice(-1)[0].selectComponent(selector), grip = b.data.handles.find(h => h.op === 'rotate');
            const q = b.createSelectorQuery(); q.select('.board-shell').boundingClientRect(); q.select('#control-rotate').boundingClientRect();
            q.exec(([r, button]) => resolve(!r || !button ? { missing:true } : { x:r.left + grip.x, y:r.top + grip.y, width:r.width, height:r.height,
              button: { x:button.left + button.width / 2, y:button.top + button.height / 2 },
              fits: button.left >= r.left - 1 && button.top >= r.top - 1 && button.right <= r.right + 1 && button.bottom <= r.bottom + 1 }));
          }), selector);
          assert.ok(!position.missing, 'The rotation button must be measurable');
          assert.ok(Math.hypot(position.x - position.button.x, position.y - position.button.y) < 1, 'Canvas and DOM control centers agree');
          assert.ok(position.fits, 'All of the held target remains inside the board');
          // Compact fitted boards constrain the whole control frame to the
          // viewport. Today has room for the complete unconstrained finger arc.
          if (name === 'today') assert.ok(Math.hypot(position.x - touch.clientX, position.y - touch.clientY) < 1, 'The held rotation button follows the finger through quadrant crossings');
          if (previousGrip) assert.ok(Math.hypot(position.x - previousGrip.x, position.y - previousGrip.y) < 40, 'A viewport constraint cannot make the control swap corners');
          previousGrip = position;
        }
        assert.equal(JSON.stringify(await state()), stored, 'Gesture previews must not persist yet');
      } });
      if (cancel) assert.equal(JSON.stringify(await state()), stored, 'Cancellation restores original placement');
      else await wait(page, d => difference(op, op === 'resize' ? placement(d).width : placement(d).angle, op === 'resize' ? original.width * value : ((original.angle + value) % 360 + 360) % 360) < .01, 'drag commit');
      const after = JSON.stringify(await state());
      if (!canvas) { await node.tap(); assert.equal(JSON.stringify(await state()), after, 'A synthetic tap cannot add a transform'); }
    }
    await drag('resize', 1.25, true); await drag('resize', .8, true);
    await drag('rotate', 37.5, true); await drag('rotate', -37.5, true);
    await drag('resize', 1.2); await drag('resize', 1 / 1.2);
    await drag('rotate', -28.3); await drag('rotate', 65.8);
    await drag('resize', 1.2, false, true); await drag('rotate', 30, true, true);
    const beforeTap = JSON.stringify(await state());
    for (const op of ['resize', 'rotate']) await (await board.$('.grip[data-op="' + op + '"]')).tap();
    assert.equal(JSON.stringify(await state()), beforeTap, 'A tap alone never scales or rotates');
    const current = await page.data(), saved = await state();
    assert.ok(Math.abs(saved.boards[current.date].placements.find(p => p.memoryId === id).angle - 37.5) < .01);
    assert.deepEqual(current.model.items.find(p => p.memoryId === other.memoryId), other);
    assert.equal(current.memoryCardId, ''); assert.equal(current.selected, id);
    // Capture the actual native canvas, including its controls. The DevTools
    // full-window screenshot RPC can time out after a remote-debug session.
    const pixels = await mini.evaluate(selector => {
      const b = getCurrentPages().slice(-1)[0].selectComponent(selector);
      return b.canvas.toDataURL('image/png').split(',')[1];
    }, selector);
    fs.writeFileSync(path.join(output, name + '-board.png'), Buffer.from(pixels, 'base64'));

    const prompts = await mini.evaluate(() => getApp().__boardControls.prompts);
    await mini.mockWxMethod('showModal', { confirm: false, cancel: true }); modalMocked = true;
    await pressOverlay(board, selector, id, 'remove');
    for (let n = 0; n < 100; n++) {
      const done = await mini.evaluate(() => getApp().__boardControls.prompts > 0 && !getCurrentPages().slice(-1)[0].mutating);
      if (done) break; await pause(50);
    }
    assert.equal(await mini.evaluate(() => getApp().__boardControls.prompts), prompts + 1);
    assert.deepEqual(await state(), saved, 'Cancel keeps every memory and placement');
    await mini.mockWxMethod('showModal', { confirm: true, cancel: false });
    await pressOverlay(board, selector, id, 'remove'); await wait(page, d => d.count === 1 && !d.selected, 'confirmed removal');
    assert.equal(await mini.evaluate(() => getApp().__boardControls.prompts), prompts + 2);
    const removed = await state();
    assert.deepEqual(removed.memories, saved.memories, 'Removing a placement preserves original memories');
    for (const [boardId, value] of Object.entries(saved.boards)) if (boardId !== current.date) assert.deepEqual(removed.boards[boardId], value);
    await mini.restoreWxMethod('showModal'); modalMocked = false;
    await page.callMethod('done');
    checks.push(name + ': Canvas and overlay continuous scale/rotate; intermediate previews; release saves; cancellation restores; taps do not transform; removal and storage scope checked');
    console.log('PASS:', name);
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', error => errors.push(error)); fs.mkdirSync(output, { recursive: true });
    originalRoute = await mini.evaluate(() => {
      if (wx.getSystemInfoSync().platform !== 'devtools') throw Error('Run this acceptance in the simulator only');
      const p = getCurrentPages().slice(-1)[0];
      if (!p || !['pages/index/index', 'pages/board-tab/index', 'pages/calendar/index'].includes(p.route)) throw Error('Start from an idle tab');
      for (const p of getCurrentPages()) if (p.dirty || p.noteDirty || p.photoTask || p.data.editable || p.data.editorOpen || p.data.drawer || p.data.memoryCardId || p.data.shareBoardId || p.data.boardDate || p.data.formOpen) throw Error('Finish current editing before acceptance');
      return '/' + p.route;
    });
    before = await snapshot();
    await mini.callWxMethod('switchTab', { url: '/pages/index/index' }); await pause(500);
    installed = true;
    await mini.evaluate(() => {
      const storeModule = require('core/store.js'), store = storeModule.getStore(), platform = require('services/platform.js');
      const q = getApp().__boardControls = { originalStore: { ...store }, confirmRemovePlacement: platform.confirmRemovePlacement, prompts: 0 };
      const disk = {}, isolated = storeModule.createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
      const photos = { originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72 };
      const today = require('core/date.js').key(), past = '2020-01-01';
      const ids = ['one', 'two'].map(id => isolated.add('control_' + id, today, photos));
      ['one', 'two'].forEach(id => isolated.add('control_old_' + id, past, photos));
      const theme = isolated.createTheme('controls', '按钮验证'); ids.forEach(id => isolated.place(id, theme));
      for (const id of [today, past, theme]) {
        const b = isolated.board(id); b.placements.forEach((p, i) => { p.x = 705 + 470 * i; p.y = 460; p.width = p.height = 280; }); isolated.saveBoard(b);
      }
      isolated.commit(s => { s.localNoticeSeen = true; }); Object.assign(store, isolated);
      platform.confirmRemovePlacement = () => { q.prompts++; return q.confirmRemovePlacement(); };
      getCurrentPages().slice(-1)[0].refresh();
    });
    await exercise('#today-board', 'today');
    await mini.callWxMethod('switchTab', { url: '/pages/board-tab/index' }); await pause(500);
    await exercise('#board', 'theme');
    await mini.callWxMethod('navigateTo', { url: '/pages/board/index?date=2020-01-01' }); await pause(500);
    await exercise('#board', 'history');
    assert.deepEqual(errors, []); assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'User storage must remain unchanged');
  } finally {
    if (mini) {
      try {
        if (modalMocked) await mini.restoreWxMethod('showModal');
        if (installed) {
          // Finish isolated page lifecycles while their isolated store still owns all data.
          const current = await mini.currentPage();
          if (current && current.path === 'pages/board/index') await mini.callWxMethod('navigateBack', {});
          await mini.evaluate(() => {
            const q = getApp().__boardControls; if (!q) return;
            for (const p of getCurrentPages()) { if (p.cancelGesture) p.cancelGesture(); p.dirty = false; p.noteDirty = false; p.history = null; p.draft = null; p.setData({ editable: false, selected: '' }); }
            const store = require('core/store.js').getStore(); Object.assign(store, q.originalStore); store.load();
            require('services/platform.js').confirmRemovePlacement = q.confirmRemovePlacement; delete getApp().__boardControls;
            getCurrentPages().forEach(p => p.refresh && p.refresh());
            if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({});
          });
        }
        if (originalRoute) await mini.callWxMethod('switchTab', { url: originalRoute });
        if (before) assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'User storage must remain unchanged');
      } finally { mini.disconnect(); }
    }
  }
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: true, userStorageUnchanged: true, checks, limitations: ['Simulator touch dispatch; physical device still needs verification', 'System confirmation choices mocked; actual removal uses only isolated test records'] }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
