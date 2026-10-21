// Run after compilation; do not edit/recompile while storage is isolated.
// Touch coordinates go through the actual component handlers and long-press timer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const dragControl = require('./helpers/drag-control');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve(__dirname, '../artifacts/board-gestures');

(async () => {
  let mini, backup, fileBackup, restored = false;
  const checks = [], errors = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
  async function launch(url) {
    await mini.evaluate(url => new Promise((resolve, reject) => wx.reLaunch({ url, success: () => resolve(true), fail: e => reject(Error(e.errMsg)) })), url);
    await pause(800); return mini.currentPage();
  }
  async function wait(target, predicate) {
    for (let i = 0; i < 100; i++) { const data = await target.data(); if (predicate(data)) return data; await pause(100); }
    const data = await target.data();
    throw new Error('Gesture state did not settle: ' + JSON.stringify({ editable: data.editable, selected: data.selected, memoryCardId: data.memoryCardId, covered: data.covered, canEdit: data.canEdit }));
  }
  async function press(selector, id, duration = 100, move = 0) {
    await wait(await (await mini.currentPage()).$(selector), d => !d.covered && d.interactive);
    await mini.evaluate((selector, id) => new Promise(resolve => {
      const board = getCurrentPages().slice(-1)[0].selectComponent(selector);
      board.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
        const item = board.displayModel.items.find(item => item.memoryId === id);
        const touch = { clientX: rect.left + (item.x + 45) * board.screenWidth / 1500, clientY: rect.top + (item.y + 45) * board.screenWidth / 1500 };
        board.acceptanceTouch = touch;
        board.touchStart({ touches: [touch] }); resolve(true);
      }).exec();
    }), selector, id);
    for (let i = 0; i < 50; i++) {
      const ready = await mini.evaluate(selector => {
        const g = getCurrentPages().slice(-1)[0].selectComponent(selector).gesture; return !!g && !g.pending;
      }, selector);
      if (ready) break;
      if (i === 49) throw new Error('Touch hit testing did not finish');
      await pause(20);
    }
    if (move) await mini.evaluate((selector, dx) => {
      const board = getCurrentPages().slice(-1)[0].selectComponent(selector);
      board.touchMove({ touches: [{ ...board.acceptanceTouch, clientX: board.acceptanceTouch.clientX + dx }] });
    }, selector, move);
    await pause(duration);
    await mini.evaluate(selector => getCurrentPages().slice(-1)[0].selectComponent(selector).touchEnd(), selector);
  }
  async function exercise(page, selector, ids, name) {
    await wait(page, d => !d.loading && d.count === 2);
    const board = await page.$(selector), pageId = page.id;
    await wait(board, d => d.width > 0 && !d.imageError); await pause(300);
    await press(selector, ids[0]); await wait(page, d => d.memoryCardId === ids[0]);
    assert.equal((await page.data()).selected, ''); assert.equal((await page.data()).editable, false);
    let card = await page.$('#memory-card'); await wait(card, d => !!d.memory && !d.pickupBusy);
    await (await card.$('#close-memory-card')).tap(); await wait(page, d => !d.memoryCardId);
    await press(selector, ids[0], 850); await wait(page, d => d.editable && d.selected === ids[0]);
    await wait(board, d => d.handles.length === 3); assert.equal((await page.data()).memoryCardId, '');
    const original = (await page.data()).model.items.find(item => item.memoryId === ids[0]);
    await dragControl(mini, board, selector, 'resize', 1.2); await wait(page, d => d.model.items.find(item => item.memoryId === ids[0]).width > original.width);
    await dragControl(mini, board, selector, 'rotate', 27.5); await wait(page, d => d.model.items.find(item => item.memoryId === ids[0]).angle !== original.angle);
    const current = await page.data(), saved = JSON.parse(await mini.callWxMethod('getStorageSync', keys[0]));
    const placement = saved.boards[current.date].placements.find(item => item.memoryId === ids[0]);
    assert.ok(placement.width > original.width); assert.ok(Math.abs(placement.angle - 27.5) < .01); assert.equal(current.memoryCardId, '');
    await mini.screenshot({ path: path.join(output, name + '-editing.png') });
    // Swiping an unselected object must neither select, edit nor open it.
    const beforeSwipe = JSON.stringify(saved.boards[current.date]);
    await press(selector, ids[1], 850, 20); assert.equal((await page.data()).selected, ids[0]); assert.equal((await page.data()).memoryCardId, '');
    const afterSwipe = JSON.parse(await mini.callWxMethod('getStorageSync', keys[0])); assert.equal(JSON.stringify(afterSwipe.boards[current.date]), beforeSwipe);
    await press(selector, ids[1]); await wait(page, d => d.memoryCardId === ids[1]); assert.equal((await page.data()).selected, ids[0]);
    card = await page.$('#memory-card'); await wait(card, d => !!d.memory && !d.pickupBusy);
    await (await card.$('#close-memory-card')).tap(); await wait(page, d => !d.memoryCardId);
    await press(selector, ids[1], 850); await wait(page, d => d.selected === ids[1]);
    await wait(board, d => d.selected === ids[1]);
    assert.equal((await page.data()).canUndo, true); assert.equal((await page.data()).memoryCardId, '');
    const x = (await page.data()).model.items.find(item => item.memoryId === ids[1]).x;
    await press(selector, ids[1], 150, -20); await wait(page, d => d.model.items.find(item => item.memoryId === ids[1]).x < x);
    assert.equal((await mini.currentPage()).id, pageId);
    await page.callMethod('done'); await wait(page, d => !d.editable && !d.selected);
    checks.push(name + ': tap card without selection; hold to edit; scale/rotate persist; unselected swipe ignored; switch selection without losing undo; selected drag; finish');
    console.log('PASS:', name);
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    await pause(1500);
    mini.on('exception', error => errors.push(error)); fs.mkdirSync(output, { recursive: true }); backup = await snapshot();
    fileBackup = await mini.evaluate(() => {
      const fm = wx.getFileSystemManager(), directory = wx.env.USER_DATA_PATH + '/felt-journal';
      try { return fm.readdirSync(directory).map(name => ({ path: directory + '/' + name, bytes: fm.readFileSync(directory + '/' + name, 'base64') })); }
      catch (error) { if (/no such file|not exist|ENOENT/i.test(error.errMsg || error.message)) return []; throw error; }
    });
    // A durable, ignored backup also survives a process or DevTools crash.
    fs.writeFileSync(path.join(output, 'storage-backup-' + Date.now() + '.json'), JSON.stringify({ storage: backup, files: fileBackup }));
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const photos = { originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72 };
    const today = dates.key(), past = '2020-01-01';
    const ids = ['one', 'two'].map(id => store.add('gesture_' + id, today, photos));
    const older = ['one', 'two'].map(id => store.add('gesture_old_' + id, past, photos));
    const theme = store.createTheme('gestures', '手势验证'); ids.forEach(id => store.place(id, theme));
    [today, past, theme].forEach(id => { const board = store.board(id); board.placements.forEach((p, i) => { p.x = 380 + 600 * i; p.y = 460; p.width = p.height = 280; }); store.saveBoard(board); });
    store.commit(s => { s.localNoticeSeen = true; });
    await mini.evaluate((names, raw) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], raw); }, keys, disk[keys[0]]);
    const home = await launch('/pages/index/index'); await exercise(home, '#today-board', ids, 'today');
    await mini.evaluate(() => new Promise((resolve, reject) => wx.switchTab({ url: '/pages/board-tab/index', success: () => resolve(true), fail: e => reject(Error(e.errMsg)) })));
    await exercise(await mini.currentPage(), '#board', ids, 'theme');
    await mini.evaluate(date => new Promise((resolve, reject) => wx.navigateTo({ url: '/pages/board/index?date=' + date, success: () => resolve(true), fail: e => reject(Error(e.errMsg)) })), past);
    await exercise(await mini.currentPage(), '#board', older, 'historical-board');
    assert.deepEqual(errors, []);
  } finally {
    if (mini) {
      try {
        if (backup) {
          // Never let a failed navigation prevent storage restoration.
          await mini.evaluate(() => getCurrentPages().forEach(p => {
            if (p.cancelGesture) p.cancelGesture(); p.dirty = false; p.noteDirty = false;
          })).catch(() => {});
          await mini.evaluate(items => items.forEach(i => i.exists ? wx.setStorageSync(i.key, i.value) : wx.removeStorageSync(i.key)), backup);
          if (fileBackup) await mini.evaluate(files => {
            const fm = wx.getFileSystemManager();
            for (const file of files) {
              let current; try { current = fm.readFileSync(file.path, 'base64'); } catch (_) {}
              if (current !== file.bytes) fm.writeFileSync(file.path, file.bytes, 'base64');
            }
          }, fileBackup);
          assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(backup), 'Original storage must be restored exactly'); restored = true;
          await launch('/pages/index/index');
          assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(backup), 'Reopening must preserve original storage');
        }
      } finally { mini.disconnect(); }
    }
  }
  const report = { passed: true, storageRestored: restored, checks };
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
