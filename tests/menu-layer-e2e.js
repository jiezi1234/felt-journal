/* Observe actual native paint/export calls during real header touches. Hidden
 * flags alone do not detect the simulator's canvas compositing flash. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:active-theme:v1'];
const output = path.resolve(__dirname, '../artifacts/menu-layer');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let mini, backup, page;
  const checks = [], errors = [];
  async function wait(predicate) {
    for (let i = 0; i < 80; i++) { if (await mini.evaluate(predicate)) return; await pause(60); }
    throw Error('Menu/canvas did not settle');
  }
  async function idle() {
    await wait(() => { const p = getCurrentPages().slice(-1)[0], b = p && p.selectComponent('#today-board');
      return b && !p.data.loading && !b.data.navigationAnimating && !b.journalSource && !b.data.canvasHidden && !b.data.snapshotVisible && b.displayModel && b.displayModel.id === p.data.date;
    });
  }
  async function tap(selector) { const element = await page.$(selector); assert.ok(element, selector); await element.tap(); }
  async function state() {
    return mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0], b = p.selectComponent('#today-board');
      return { frozen: b.data.freezeCanvas, hidden: b.data.canvasHidden, raster: !!b.data.snapshot && b.data.snapshotVisible,
        width: b.data.width, height: b.data.height, paints: p.__nativeAudit.paints, exports: p.__nativeAudit.exports, violations: p.__nativeAudit.violations, entries: p.__nativeAudit.entries };
    });
  }
  async function more(mode) {
    await idle();
    const touch = await mini.evaluate(selector => new Promise(resolve => {
      const p = getCurrentPages().slice(-1)[0]; p.createSelectorQuery().select(selector).boundingClientRect(r => resolve({ identifier: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 })).exec();
    }), mode === 'calendar' ? '#calendar-options' : '#theme-options');
    const canvas = await (await page.$('#today-board')).$('#feltCanvas');
    await canvas.touchstart({ touches: [touch], changedTouches: [touch] });
    await pause(80); await canvas.touchend({ touches: [], changedTouches: [touch] });
    await wait(() => !!getCurrentPages().slice(-1)[0].data.drawer);
    await pause(400);
    const current = await state();
    assert.ok(current.frozen && current.hidden && current.raster);
    assert.deepEqual(current.violations, [], 'No native draw/export occurs from first occlusion through menu entry');
    assert.equal(await canvas.style('display'), 'none');
    assert.ok(current.entries.every(e => e.frozen && e.hidden && e.raster), 'Raster is ready before mounting each menu');
    return current;
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    assert.equal(await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return !!(p && (p.dirty || p.noteDirty || p.photoTask || p.busy && p.busy())); }), false, 'Finish editing before acceptance');
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'storage-backup.json'), JSON.stringify(backup));
    mini.on('exception', error => errors.push(error));
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const memory = store.add('menu', dates.key(), { originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72, kind: 'original' });
    const theme = store.createTheme('menu', '菜单层级验证', memory);
    store.commit(s => { s.localNoticeSeen = true; });
    await mini.evaluate((names, data, theme) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], data); wx.setStorageSync(names[4], theme); }, keys, disk[keys[0]], theme);
    await mini.callWxMethod('reLaunch', { url: '/pages/index/index' }); await pause(700); page = await mini.currentPage(); await idle();
    await mini.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0], b = p.selectComponent('#today-board'), ctx = b.canvas.getContext('2d');
      const transform = ctx.setTransform, capture = wx.canvasToTempFilePath, update = p.setData;
      const audit = p.__nativeAudit = { paints: 0, exports: 0, violations: [], entries: [] };
      const record = operation => {
        audit[operation]++;
        if (b.data.freezeCanvas) audit.violations.push({ operation, drawer: p.data.drawer, hidden: b.data.canvasHidden });
      };
      ctx.setTransform = function (...args) { record('paints'); return transform.apply(this, args); };
      wx.canvasToTempFilePath = function (options, ...args) { if (options.canvas === b.canvas) record('exports'); return capture.call(this, options, ...args); };
      p.setData = function (data, done) {
        if (data.drawer === 'calendar-options' || data.drawer === 'theme') audit.entries.push({ frozen: b.data.freezeCanvas, hidden: b.data.canvasHidden, raster: !!b.data.snapshot && b.data.snapshotVisible });
        return update.call(this, data, done);
      };
      p.__restoreNativeAudit = () => { ctx.setTransform = transform; wx.canvasToTempFilePath = capture; p.setData = update; };
    });
    const baseline = await state();
    for (const mode of ['calendar', 'themes']) {
      if (mode === 'themes') { await page.callMethod('switchMode'); await idle(); }
      for (let i = 0; i < 3; i++) {
        const shown = await more(mode);
        assert.equal(shown.width, baseline.width); assert.equal(shown.height, baseline.height);
        if (i === 0 && process.argv.includes('--screenshots')) await mini.screenshot({ path: path.join(output, `${mode}-more.png`) });
        await tap('#close-drawer'); await idle();
        assert.ok((await state()).paints > shown.paints, 'Closing restores live native painting');
      }
      const shown = await more(mode);
      await tap(mode === 'calendar' ? '#calendar-appearance' : '#theme-appearance');
      await wait(() => { const p = getCurrentPages().slice(-1)[0]; return p.data.drawer === 'appearance' && !p.selectComponent('#today-board').data.freezeCanvas; });
      await page.callMethod('texture', { currentTarget: { dataset: { value: 'long' } } }); await pause(350);
      assert.ok((await state()).paints > shown.paints, 'Appearance continues to render live previews');
      await tap('#close-appearance'); await idle();
      await more(mode); await tap('#open-memory-libraries');
      await wait(() => getCurrentPages().slice(-1)[0].data.libraryOpen);
      assert.ok((await state()).frozen); assert.deepEqual((await state()).violations, []);
      await (await (await page.$('#memory-library-card')).$('#close-library-card')).tap();
      await wait(() => getCurrentPages().slice(-1)[0].data.sheetScene === 'menu');
      await tap('#close-drawer'); await idle();
      checks.push(`${mode}: repeated native More taps, first-frame raster, zero hidden paints/exports, appearance and library navigation`);
    }
    const result = await state(); assert.ok(result.paints > 0 && result.exports > 0, 'Instrumentation observed native work');
    assert.equal(result.entries.length, 12, 'Includes returning from each library to its existing menu'); assert.deepEqual(result.violations, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, menuEntries: result.entries.length, hiddenNativeOperations: result.violations.length, checks }, null, 2));
  } finally {
    if (mini) {
      try {
        await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; if (p && p.__restoreNativeAudit) p.__restoreNativeAudit(); });
        if (backup) {
          await mini.evaluate(items => { const p = getCurrentPages().slice(-1)[0]; if (p && p.onHide) p.onHide(); items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)); }, backup);
          await mini.callWxMethod('reLaunch', { url: '/pages/index/index' }); await pause(700);
          assert.deepEqual(await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys), backup);
          console.log('PASS: original storage restored exactly');
        }
      } finally { mini.disconnect(); }
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, storageRestored: true, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
