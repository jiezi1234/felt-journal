// Read-only acceptance against current records: no fixture replacement, edits,
// photo processing, draft recovery or application restart. Deletion is always
// canceled through a scoped showModal mock; current records are never deleted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const output = path.resolve(__dirname, '../artifacts/calendar-card');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  let mini, before, calendar, month, modalMocked = false;
  const checks = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
  async function wait(target, predicate) {
    for (let i = 0; i < 100; i++) { if (predicate(await target.data())) return; await pause(100); }
    throw Error('Calendar card did not reach the expected state');
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    before = await snapshot(); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'storage-before-' + Date.now() + '.json'), JSON.stringify(before));
    await mini.evaluate(() => new Promise((resolve, reject) => wx.switchTab({ url: '/pages/calendar/index', success: () => resolve(true), fail: e => reject(Error(e.errMsg)) })));
    await pause(400); calendar = await mini.currentPage(); await wait(calendar, d => !d.loading);
    assert.equal((await calendar.data()).boardDate, '', 'Leave an existing open card untouched');
    month = { year: (await calendar.data()).year, month: (await calendar.data()).month };
    const pageId = calendar.id, stack = (await mini.pageStack()).length;
    const target = await mini.evaluate(() => {
      const store = require('core/store.js').getStore(), dates = require('core/date.js'), today = dates.key();
      const state = store.get();
      const board = Object.values(state.boards).filter(b => b.type !== 'theme' && b.date <= today && b.placements.length && !store.getDraft(b.date))
        .sort((a, b) => b.date.localeCompare(a.date))[0];
      const date = board ? board.date : today;
      if (store.getDraft(date)) throw Error('Selected day has a draft; skipping read-only acceptance');
      const memory = board && board.placements.find(p => !store.getMemoryDraft(p.memoryId));
      const p = getCurrentPages().slice(-1)[0]; p.year = Number(date.slice(0, 4)); p.month = Number(date.slice(5, 7)); p.refresh();
      return { date, memoryId: memory ? memory.memoryId : '', year: p.year, month: p.month };
    });
    await wait(calendar, d => d.year === target.year && d.month === target.month);
    await (await calendar.$(`.day[data-date="${target.date}"]`)).tap(); await wait(calendar, d => d.boardDate === target.date);
    const card = await calendar.$('#day-board-card'); await wait(card, d => !d.loading && !!d.model);
    assert.equal((await mini.currentPage()).id, pageId); assert.equal((await mini.pageStack()).length, stack);
    await mini.evaluate(() => getCurrentPages().slice(-1)[0].getTabBar().sync());
    assert.equal(await mini.evaluate(() => getCurrentPages().slice(-1)[0].getTabBar().data.hidden), true);
    const rects = await mini.evaluate(() => new Promise(resolve => {
      const c = getCurrentPages().slice(-1)[0].selectComponent('#day-board-card');
      c.createSelectorQuery().select('.day-board-dialog').boundingClientRect().select('.day-board-stage').boundingClientRect().select('#close-day-board').boundingClientRect().exec(rects => resolve({ rects, height: wx.getWindowInfo().windowHeight }));
    }));
    for (const r of rects.rects) assert.ok(r && r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= rects.height, 'Day card stays within the viewport');
    await pause(500); await mini.screenshot({ path: path.join(output, 'day-board.png') });
    checks.push('Native date tap opens a bounded day card, hides navigation and preserves the calendar page and stack');
    if ((await card.data()).canEdit) {
      assert.equal((await card.data()).editable, false, 'Date opens in browsing mode');
      const toolbar = await mini.evaluate(() => new Promise(resolve => {
        const c = getCurrentPages().slice(-1)[0].selectComponent('#day-board-card');
        c.createSelectorQuery().select('.day-board-dialog').boundingClientRect().select('#add-day-photo').boundingClientRect().exec(resolve);
      }));
      for (const r of toolbar.slice(1)) assert.ok(r && r.width > 0 && r.height > 0 && r.top >= toolbar[0].top && r.bottom <= toolbar[0].bottom, 'Toolbar is visible within the card before long-press');
      await (await card.$('#add-day-photo')).tap(); await wait(card, d => d.drawer === 'source');
      assert.ok(await card.$('#source-camera')); assert.ok(await card.$('#source-album'));
      await (await card.$('#close-drawer')).tap(); await wait(card, d => !d.drawer);
      assert.equal((await card.data()).editable, false);
      assert.equal(await card.$('#more-day-board'), null);
      assert.equal((await mini.currentPage()).id, pageId); assert.equal((await mini.pageStack()).length, stack);
      checks.push('Add stays visible in browsing mode and opens its drawer in place; More is absent');
    }
    if (target.memoryId) {
      await card.callMethod('memory', { detail: { id: target.memoryId } }); await wait(card, d => d.memoryCardId === target.memoryId);
      const memory = await card.$('#memory-card'); await wait(memory, d => !!d.memory);
      const board = await card.$('#board'); await wait(board, d => d.covered);
      await (await memory.$('#flip-card')).tap(); await wait(memory, d => d.flipped);
      await (await memory.$('#close-memory-card')).tap(); await wait(card, d => !d.memoryCardId);
      assert.equal((await card.data()).date, target.date); assert.equal((await mini.currentPage()).id, pageId);
      checks.push('Nested memory opens and flips in place, covers the canvas and closes back to the same day');
      await wait(board, d => !d.covered);
      await mini.evaluate(id => new Promise(resolve => {
        const b = getCurrentPages().slice(-1)[0].selectComponent('#day-board-card').selectComponent('#board');
        b.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
          const p = b.displayModel.items.find(p => p.memoryId === id), config = require('core/config.js').board;
          b.touchStart({ touches: [{ clientX: rect.left + (p.x + config.inset) * b.screenWidth / config.width, clientY: rect.top + (p.y + config.inset) * b.screenWidth / config.width }] }); resolve(true);
        }).exec();
      }), target.memoryId);
      await wait(card, d => d.selected === target.memoryId);
      await board.callMethod('touchEnd'); await wait(board, d => d.handles.length === 3);
      assert.equal(await card.$('#more-day-board'), null, 'More stays absent after long press');
      await mini.screenshot({ path: path.join(output, 'delete-control.png') });
      await mini.mockWxMethod('showModal', options => {
        getCurrentPages().slice(-1)[0].acceptanceDeletePrompt = { title: options.title, confirmText: options.confirmText, cancelText: options.cancelText };
        return { confirm: false, cancel: true };
      }); modalMocked = true;
      await (await board.$('.grip[data-op="remove"]')).tap();
      for (let i = 0; i < 100; i++) {
        if (await mini.evaluate(() => !!getCurrentPages().slice(-1)[0].acceptanceDeletePrompt)) break;
        await pause(100);
      }
      assert.deepEqual(await mini.evaluate(() => getCurrentPages().slice(-1)[0].acceptanceDeletePrompt), { title: '是否删除该部件？', confirmText: '确定', cancelText: '取消' });
      await mini.restoreWxMethod('showModal'); modalMocked = false;
      assert.equal(await mini.evaluate(() => !!getCurrentPages().slice(-1)[0].selectComponent('#day-board-card').mutating), false);
      assert.equal((await card.data()).selected, target.memoryId);
      assert.ok((await card.data()).model.items.some(p => p.memoryId === target.memoryId));
      checks.push('Long press reveals three controls; delete requests confirmation and a mocked cancel preserves the object');
    }
    await (await card.$('#close-day-board')).tap(); await wait(calendar, d => !d.boardDate);
    assert.equal((await calendar.data()).month, target.month); assert.equal((await calendar.data()).year, target.year);
    assert.equal(await mini.evaluate(() => getCurrentPages().slice(-1)[0].getTabBar().data.hidden), false);
    checks.push('Closing restores the same month and bottom navigation');
  } finally {
    if (mini) {
      try {
        if (modalMocked) await mini.restoreWxMethod('showModal');
        if (calendar && month) await mini.evaluate(month => {
          const p = getCurrentPages().slice(-1)[0], card = p.selectComponent('#day-board-card');
          delete p.acceptanceDeletePrompt;
          if (card) { if (card.data.memoryCardId) card.closeMemoryCard(); if (card.data.drawer) card.closeDrawer(); card.close(); }
          p.year = month.year; p.month = month.month; p.refresh();
        }, month);
        if (before) assert.ok(JSON.stringify(await snapshot()) === JSON.stringify(before), 'Acceptance must leave records, drafts and server configuration unchanged');
      } finally { mini.disconnect(); }
    }
  }
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: true, readOnly: true, checks }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
