/* Native recall acceptance with isolated local fixtures. Never uploads or sends
 * photos. Do not run alongside another simulator test or recompile mid-run. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const automator = require('miniprogram-automator');
const { createStore, KEY } = require('../miniprogram/core/store');
const recall = require('../miniprogram/core/memory-recall');
const dates = require('../miniprogram/core/date');
const output = path.resolve(__dirname, '../artifacts/memory-recall');
const keys = [KEY, 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:active-theme:v1', recall.KEY];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let mini, backup, page, card, files = [];
  const errors = [], checks = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key), exists: wx.getStorageInfoSync().keys.includes(key) })), keys);
  async function wait(predicate, message = 'Recall did not settle') {
    for (let i = 0; i < 100; i++) { if (await mini.evaluate(predicate)) return; await pause(80); }
    throw Error(message);
  }
  async function tap(selector, target = page) { const element = await target.$(selector); assert.ok(element, selector); await element.tap(); await pause(100); }
  async function capture(name) { await pause(480); await mini.screenshot({ path: path.join(output, name + '.png') }); }
  async function hasCorner() { return mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#today-board').data.actions.some(a => a.action === 'recall')); }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    assert.equal(await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return !!(p && (p.dirty || p.noteDirty || p.photoTask || p.data.editable || p.busy && p.busy() || p.data.drawer)); }), false, 'Finish existing work before acceptance');
    backup = await snapshot(); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'storage-backup.json'), JSON.stringify(backup));
    const image = createCanvas(180, 180), ctx = image.getContext('2d');
    ctx.fillStyle = '#C78E50'; ctx.beginPath(); ctx.roundRect(32, 42, 100, 94, 22); ctx.fill();
    ctx.strokeStyle = '#C78E50'; ctx.lineWidth = 13; ctx.beginPath(); ctx.arc(132, 85, 28, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    ctx.fillStyle = '#49382C'; ctx.beginPath(); ctx.ellipse(82, 47, 44, 10, 0, 0, Math.PI * 2); ctx.fill();
    files = await mini.evaluate(bytes => {
      const prefix = wx.env.USER_DATA_PATH + '/recall-test-' + Date.now();
      const paths = [prefix + '-original.png', prefix + '-subject.png'];
      paths.forEach(file => wx.getFileSystemManager().writeFileSync(file, bytes, 'base64')); return paths;
    }, image.toBuffer('image/png').toString('base64'));
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const today = dates.key(), ago = days => { const value = new Date(); value.setDate(value.getDate() - days); return dates.key(value); };
    const old = [31, 14, 2].map((days, i) => {
      const id = store.add('old-' + i, ago(days), { originalPath: files[0], subjectPath: files[1], width: 180, height: 180, kind: 'original' });
      store.edit(id, ['下雨的下午，绕路买了一杯热咖啡。', '散步之后的一杯热饮。', '和朋友聊了很久。'][i], '未分类'); return id;
    });
    const todayId = store.add('today', today, { originalPath: files[0], subjectPath: files[1], width: 180, height: 180, kind: 'original' });
    store.createTheme('recall', '回顾验收', old[0]); store.commit(s => { s.localNoticeSeen = true; s.boardGuideSeen = true; });
    await mini.evaluate((names, value) => {
      const p = getCurrentPages().slice(-1)[0], c = p && p.selectComponent('#memory-recall'); if (c) { c.visible = false; c.stopTimer(); }
      names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], value);
    }, keys, disk[KEY]);
    mini.on('exception', error => errors.push(error));
    page = await mini.reLaunch('/pages/index/index');
    await wait(() => { const p = getCurrentPages().slice(-1)[0], b = p.selectComponent('#today-board'); return !p.data.loading && b && b.data.actions.some(a => a.action === 'recall'); });
    card = await page.$('#memory-recall'); const board = await page.$('#today-board');
    const original = await page.data();
    const layout = (await board.data()).actions, corner = layout.find(a => a.action === 'recall'), add = layout.find(a => a.action === 'record');
    assert.ok(corner.x + corner.width < add.x); await capture('home-corner');
    const startId = (await card.data()).item.id;
    console.log('STEP: idle home corner ready; verifying actual 45-second rotation');
    await pause(recall.INTERVAL + 350);
    assert.notEqual((await card.data()).item.id, startId); await capture('idle-rotated');
    checks.push('actual 45-second idle rotation; corner and Add hit targets do not overlap');
    // Use the same native canvas action handler that owns the visible corner.
    await tap('#journal-recall', board);
    await wait(() => getCurrentPages().slice(-1)[0].data.recallOpen);
    await wait(() => { const c = getCurrentPages().slice(-1)[0].selectComponent('#memory-recall').selectComponent('#recall-object'); return c && !!c.data.previewPath && !c.data.pending; }, 'Stitched subject snapshot did not render');
    await capture('object-review');
    const pinnedItem = (await card.data()).item;
    await card.setData({ item: { ...pinnedItem, text: Array(20).fill('那天留下的一段很长的记忆，回头看时仍然很清楚。').join('\n') } });
    const footer = await mini.evaluate(() => new Promise(resolve => {
      const c = getCurrentPages().slice(-1)[0].selectComponent('#memory-recall'), query = c.createSelectorQuery();
      query.select('.recall-scroll').boundingClientRect(); query.select('.recall-footer').boundingClientRect();
      query.exec(rects => resolve({ rects, height: wx.getSystemInfoSync().windowHeight }));
    }));
    assert.ok(footer.rects[1].top >= footer.rects[0].bottom - 1);
    assert.ok(footer.rects[1].bottom <= footer.height);
    await capture('long-note');
    await card.setData({ item: { ...pinnedItem, text: '' } }); await capture('no-note');
    await card.setData({ item: pinnedItem });
    checks.push('stitched subject snapshot renders; long notes scroll above fixed actions; no-note layout remains complete');
    const shown = (await card.data()).item.id;
    await tap('#next-recall', card); assert.notEqual((await card.data()).item.id, shown);
    const next = (await card.data()).item.id;
    await tap('#close-recall', card); await wait(() => !getCurrentPages().slice(-1)[0].data.recallOpen); await pause(500);
    assert.equal((await card.data()).item.id, next); assert.deepEqual((await page.data()).model, original.model);
    checks.push('next object and ordinary close retain the current date and saved board');
    await tap('#journal-recall', board); await wait(() => getCurrentPages().slice(-1)[0].data.recallOpen); await pause(450);
    const target = (await card.data()).item;
    await tap('#recall-show-day', card); await wait(() => !getCurrentPages().slice(-1)[0].data.recallOpen); await pause(650);
    const destination = await page.data();
    assert.equal(destination.mode, 'calendar'); assert.equal(destination.date, target.date); assert.equal(destination.dailyDate, target.date);
    assert.equal(destination.model.id, target.date); assert.ok(destination.model.items.some(item => item.memoryId === target.id));
    assert.equal(destination.navigationBusy, false); assert.equal(destination.canEdit, true); assert.equal(await hasCorner(), false);
    const liveBoard = await board.data(); assert.equal(liveBoard.occluded, false); assert.equal(liveBoard.covered, false); assert.equal(liveBoard.freezeCanvas, false);
    assert.equal(await mini.evaluate(() => getCurrentPages().length), 1);
    await capture('calendar-day');
    await tap('#journal-canvas-quick', board); await pause(650);
    assert.equal((await page.data()).date, today); assert.deepEqual((await page.data()).model, original.model); assert.equal(await hasCorner(), true);
    checks.push('View that day closes recall and opens its actual calendar board; date, content and navigation agree; Return to today works');
    const beforeEdit = (await card.data()).item.id;
    await page.callMethod('editItem', { detail: { id: todayId } }); await pause(500);
    assert.equal((await card.data()).editing, true); assert.equal(await hasCorner(), false); await capture('editing-hidden');
    await page.callMethod('select', { detail: { id: '' } });
    await wait(() => { const c = getCurrentPages().slice(-1)[0].selectComponent('#memory-recall'); return !c.data.editing && !!c.previewKey && c.previewKey !== 'null'; }); await pause(350);
    assert.equal(await hasCorner(), true); assert.notEqual((await card.data()).item.id, beforeEdit);
    await tap('#record-today'); await wait(() => getCurrentPages().slice(-1)[0].data.editorOpen);
    assert.equal((await card.data()).recording, true); assert.equal(await hasCorner(), false);
    const record = await page.$('#record-card'); await pause(500);
    await record.setData({ task: { state: 'extractError', originalPath: files[0], error: '验收示例' } });
    await capture('processing-hidden'); assert.equal((await page.data()).recallPreview, null);
    await record.setData({ task: null }); await pause(300); await tap('#close-record', record);
    await wait(() => !getCurrentPages().slice(-1)[0].data.editorOpen); await pause(650); assert.equal(await hasCorner(), true);
    checks.push('editing/drag preparation and record source/processing remain hidden until completion or cancellation');
    await page.callMethod('chooseDate', { currentTarget: { dataset: { date: ago(14) } } }); await pause(600); assert.equal(await hasCorner(), false);
    await page.callMethod('returnToday'); await pause(650); assert.equal(await hasCorner(), true);
    await page.callMethod('switchMode'); await pause(650); assert.equal(await hasCorner(), false);
    await page.callMethod('switchMode'); await pause(650); assert.equal(await hasCorner(), true);
    await tap('#journal-recall', board); await wait(() => getCurrentPages().slice(-1)[0].data.recallOpen); await pause(500);
    for (let i = 0; i < old.length; i++) { await tap('#hide-recall-item', card); await pause(120); }
    assert.equal((await card.data()).item, null); assert.equal((await card.data()).hiddenCount, old.length); await capture('all-hidden');
    await tap('#close-recall', card); await wait(() => !getCurrentPages().slice(-1)[0].data.recallOpen); await pause(500); assert.equal(await hasCorner(), false);
    await tap('#calendar-options'); await wait(() => getCurrentPages().slice(-1)[0].data.sheetScene === 'menu'); await pause(450);
    await tap('#open-recall'); await wait(() => getCurrentPages().slice(-1)[0].data.recallOpen); await pause(500);
    await tap('#restore-recall-items', card); assert.ok((await card.data()).item);
    await tap('#close-recall', card); await wait(() => !getCurrentPages().slice(-1)[0].data.recallOpen); await pause(650); assert.equal(await hasCorner(), true);
    assert.equal(await mini.callWxMethod('getStorageSync', KEY), disk[KEY]);
    assert.deepEqual(errors, []);
    checks.push('only today/calendar shows the corner; all hidden objects can be restored through More; source journal remains byte-for-byte unchanged');
  } finally {
    if (mini) {
      try {
        if (backup) {
          await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; if (p) { if (p.onHide) p.onHide(); const c = p.selectComponent('#memory-recall'); if (c) { c.visible = false; c.stopTimer(); } } });
          // Restore the source keys before reloading; restore recall preferences
          // after mount too, because entering home intentionally rotates once.
          await mini.evaluate(items => items.forEach(item => item.exists ? wx.setStorageSync(item.key, item.value) : wx.removeStorageSync(item.key)), backup);
          await mini.reLaunch('/pages/index/index'); await pause(650);
          await mini.evaluate((items, prefKey) => {
            const c = getCurrentPages().slice(-1)[0].selectComponent('#memory-recall'); if (c) c.stopTimer();
            const item = items.find(i => i.key === prefKey); if (item.exists) wx.setStorageSync(item.key, item.value); else wx.removeStorageSync(item.key);
          }, backup, recall.KEY);
          assert.deepEqual(await snapshot(), backup);
          console.log('PASS: original storage restored exactly');
        }
        if (files.length) await mini.evaluate(paths => paths.forEach(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }), files);
      } finally { mini.disconnect(); }
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, storageRestored: true }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
