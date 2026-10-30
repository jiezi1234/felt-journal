/* Isolated native checks. Uses bundled icons, never uploads or sends photos.
 * Do not run alongside another simulator test or recompile during acceptance. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const output = path.resolve(__dirname, '../artifacts/smooth-sheet');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:active-theme:v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let mini, backup, page;
  const checks = [], errors = [];
  async function wait(predicate) {
    for (let i = 0; i < 100; i++) { if (await mini.evaluate(predicate)) return; await pause(80); }
    throw Error('Sheet did not settle');
  }
  async function tap(selector, target = page) { const item = await target.$(selector); assert.ok(item, selector); await item.tap(); }
  async function capture(name) { await pause(460); await mini.screenshot({ path: path.join(output, name + '.png') }); }
  async function geometry() {
    return mini.evaluate(() => new Promise(resolve => {
      const p = getCurrentPages().slice(-1)[0], b = p.selectComponent('#today-board');
      p.createSelectorQuery().select('#journal-sheet-surface').boundingClientRect().exec(rects => resolve({
        surface: rects[0], width: b.data.width, height: b.data.height, frozen: b.data.freezeCanvas,
        hidden: b.data.canvasHidden, snapshot: b.data.snapshotVisible, viewport: wx.getWindowInfo().windowHeight
      }));
    }));
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    assert.equal(await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return !!(p && (p.dirty || p.noteDirty || p.photoTask || p.busy && p.busy())); }), false, 'Finish editing before acceptance');
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'storage-backup.json'), JSON.stringify(backup));
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const id = store.add('smooth', dates.key(), { originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72, kind: 'original' });
    const theme = store.createTheme('smooth', '动效验收', id);
    store.commit(s => { s.localNoticeSeen = true; });
    await mini.evaluate((names, raw, theme) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], raw); wx.setStorageSync(names[3], theme); }, keys, disk[keys[0]], theme);
    mini.on('exception', error => errors.push(error));
    page = await mini.reLaunch('/pages/index/index');
    await wait(() => { const p = getCurrentPages().slice(-1)[0], b = p.selectComponent('#today-board'); return !p.data.loading && b && b.canvas && !b.data.canvasHidden && b.data.width > 0; });
    await pause(500);
    for (const mode of ['calendar', 'themes']) {
      if (mode === 'themes') { await page.callMethod('switchMode'); await pause(650); }
      const baseline = await geometry();
      await tap(mode === 'calendar' ? '#calendar-options' : '#theme-options');
      await wait(() => getCurrentPages().slice(-1)[0].data.sheetScene === 'menu'); await capture(mode + '-more');
      const menu = await geometry(); assert.ok(menu.frozen && menu.hidden && menu.snapshot); assert.equal(menu.width, baseline.width);
      await tap(mode === 'calendar' ? '#calendar-appearance' : '#theme-appearance'); await capture(mode + '-appearance');
      const appearance = await geometry(); assert.ok(appearance.surface.height > menu.surface.height); assert.ok(!appearance.frozen);
      console.log(mode + ' dimensions', JSON.stringify({ baseline, appearance }));
      assert.equal(appearance.width, baseline.width, 'Receding must not resize the native canvas');
      assert.ok(Math.abs(appearance.surface.bottom - menu.surface.bottom) < 1, 'Shell remains bottom-anchored');
      await page.callMethod('texture', { currentTarget: { dataset: { value: 'long' } } });
      await tap('#sheet-back'); await pause(400); await tap('#open-memory-libraries'); await capture(mode + '-libraries');
      for (const swatch of await page.$$('felt-swatch')) {
        assert.equal((await swatch.data()).inactive, true);
        assert.equal(await (await swatch.$('#sample')).style('display'), 'none', 'Native samples cannot bleed through a hidden pane');
      }
      const card = await page.$('#memory-library-card'); assert.ok(card); assert.equal((await card.data()).inline, true);
      await tap('#all-library-objects', card); await pause(260); await tap('.library-object', card);
      await wait(() => !!getCurrentPages().slice(-1)[0].data.memoryCardId);
      const memory = await page.$('#memory-card'); await pause(500); await tap('#close-memory-card', memory);
      await wait(() => !getCurrentPages().slice(-1)[0].data.memoryCardId);
      assert.equal((await card.data()).libraryId, 'all');
      await tap('#close-library-card', card); await pause(380); assert.equal((await page.data()).sheetScene, 'menu');
      await tap('#close-drawer'); await wait(() => !getCurrentPages().slice(-1)[0].data.sheetScene); await pause(500);
      await tap('#record-today'); await wait(() => getCurrentPages().slice(-1)[0].data.editorOpen); await capture(mode + '-record');
      const record = await page.$('#record-card'); await wait(() => !getCurrentPages().slice(-1)[0].selectComponent('#record-card').data.loading);
      assert.equal((await record.data()).isTheme, mode === 'themes');
      // Deterministic visual fixture for the source -> processing height change.
      await record.setData({ task: { state: 'extractError', originalPath: '/images/navigation/board-active.png', error: '动效验收' } });
      await capture(mode + '-processing'); await record.setData({ task: null }); await pause(400);
      const added = await mini.evaluate(() => {
        const c = getCurrentPages().slice(-1)[0].selectComponent('#record-card');
        const date = Object.values(c.store.get().memories)[0].date;
        const id = c.store.add('sheet-flight-' + Date.now(), date, { originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72, kind: 'original' }, c.date, { deferPlacement: true });
        const memory = c.store.get().memories[id];
        c.photoNoteId = id;
        c.photoTask = { committed: true, state: 'done', savedId: id, id, date, targetBoardId: c.date, deferPlacement: true, originalPath: memory.originalPath, subjectPath: memory.subjectPath };
        c.setData({ task: { id, memoryId: id, state: 'done', committed: true, kind: 'original', original: memory.originalPath, previewOriginal: memory.originalPath, subject: memory.subjectPath } });
        c.photoDone(id); return id;
      });
      await wait(() => { const r = getCurrentPages().slice(-1)[0].selectComponent('#record-card').selectComponent('#record-photo'); return r && r.data.done && !r.data.revealBusy; });
      await pause(500); const panel = await record.$('#record-photo'); await tap('#continue-layout', panel);
      await wait(() => { const p = getCurrentPages().slice(-1)[0]; return !!(p.data.placing && p.data.placing.target); });
      const landing = await mini.evaluate(() => {
        const p = getCurrentPages().slice(-1)[0], id = p.data.placing.id, target = p.data.placing.target;
        return p.selectComponent('#today-board').pickupRect(id).then(expected => ({ target, expected }));
      });
      assert.ok(landing.expected);
      for (const key of ['left', 'top', 'width', 'height']) assert.ok(Math.abs(landing.target[key] - landing.expected[key]) < 1, 'Flight matches restored board: ' + key);
      await wait(() => { const p = getCurrentPages().slice(-1)[0]; return !p.data.editorOpen && !p.data.placing && p.data.editable; }); await pause(500);
      assert.equal((await page.data()).selected, added);
      assert.equal((await geometry()).width, baseline.width);
      await tap('#record-today'); await wait(() => getCurrentPages().slice(-1)[0].data.editorOpen); await pause(460);
      const closingRecord = await page.$('#record-card');
      await tap('#close-record', closingRecord); await wait(() => !getCurrentPages().slice(-1)[0].data.editorOpen); await pause(500);
      checks.push(mode + ': menu/appearance/library/back/detail, fixed bottom, record source/processing/exit, actual sticker flight to restored coordinates, stable canvas dimensions');
    }
    assert.deepEqual(errors, []);
  } finally {
    if (mini) {
      try {
        if (backup) {
          await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; if (p) { if (p.onHide) p.onHide(); p.setData({ editorOpen: false, memoryCardId: '', libraryOpen: false }); } }); await pause(300);
          await mini.evaluate(items => items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)), backup);
          await mini.reLaunch('/pages/index/index'); await pause(600);
          assert.deepEqual(await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys), backup);
          console.log('PASS: original storage restored exactly');
        }
      } finally { mini.disconnect(); }
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, storageRestored: true, limitations: ['Processing visuals use a deterministic fixture; physical devices and system pickers require phone acceptance.'] }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
