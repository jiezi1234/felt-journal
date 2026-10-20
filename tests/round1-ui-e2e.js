// Layout, keyboard and hand-off acceptance. Journal writes use an in-memory
// adapter; no production records or extraction configuration are replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { createCanvas } = require('@napi-rs/canvas');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve('artifacts/round1');
(async () => {
  let mini, backup, installed = false, files = [];
  const checks = [], errors = [], rects = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
  const act = (chain, method, argument) => mini.evaluate((chain, method, argument) => {
    const owner = chain.reduce((p, selector) => p.selectComponent(selector), getCurrentPages().slice(-1)[0]);
    return owner[method](argument);
  }, chain, method, argument);
  async function until(fn, label) { for (let n = 0; n < 80; n++) { if (await fn()) return; await pause(75); } throw Error('Timed out: ' + label); }
  async function layout(chain, selectors, label) {
    await pause(320);
    const measured = await mini.evaluate((chain, selectors) => new Promise(resolve => {
      const owner = chain.reduce((p, s) => p.selectComponent(s), getCurrentPages().slice(-1)[0]);
      const q = owner.createSelectorQuery(); selectors.forEach(s => q.select(s).boundingClientRect());
      q.exec(items => resolve({ items, height: owner.data.modalHeight || wx.getSystemInfoSync().windowHeight,
        width: wx.getSystemInfoSync().windowWidth, keyboard: owner.data.modalKeyboard }));
    }), chain, selectors);
    measured.items.forEach((r, i) => {
      assert.ok(r && r.width > 0 && r.height > 0, label + ' visible ' + selectors[i]);
      assert.ok(r.left >= -1 && r.right <= measured.width + 1 && r.top >= -1 && r.bottom <= measured.height + 1,
        label + ' fits visible viewport: ' + selectors[i] + ' ' + JSON.stringify({ r, measured }));
    }); rects.push({ label, ...measured }); checks.push(label);
  }
  const keyboard = (chain, height) => mini.evaluate((chain, height) => {
    const owner = chain.reduce((p, s) => p.selectComponent(s), getCurrentPages().slice(-1)[0]);
    owner.modalPresentation.keyboardChanged({ height });
  }, chain, height);
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', e => errors.push(e)); fs.mkdirSync(output, { recursive: true }); backup = await snapshot();
    await mini.evaluate(() => {
      if (wx.getSystemInfoSync().platform !== 'devtools') throw Error('Simulator acceptance only');
      for (const p of getCurrentPages()) if (p.dirty || p.noteDirty || p.photoTask || p.data.editorOpen || p.data.memoryCardId || p.data.shareBoardId || p.data.boardDate) throw Error('Finish editing first');
    });
    const canvas = createCanvas(600, 240), ctx = canvas.getContext('2d'); ctx.fillStyle = '#D19159';
    ctx.beginPath(); ctx.ellipse(300, 120, 240, 95, 0, 0, Math.PI * 2); ctx.fill();
    const original = createCanvas(600, 600), originalContext = original.getContext('2d');
    originalContext.fillStyle = '#F5F1E8'; originalContext.fillRect(0, 0, 600, 600); originalContext.drawImage(canvas, 0, 180);
    files = await mini.evaluate(images => {
      const file = wx.env.USER_DATA_PATH + '/felt-round1-' + Date.now() + '.png';
      wx.getFileSystemManager().writeFileSync(file, images.subject, 'base64');
      wx.getFileSystemManager().writeFileSync(file + '.original.png', images.original, 'base64'); return [file + '.original.png', file];
    }, { subject: canvas.toBuffer('image/png').toString('base64'), original: original.toBuffer('image/png').toString('base64') });
    await mini.callWxMethod('switchTab', { url: '/pages/index/index' }); await pause(200);
    installed = true;
    await mini.evaluate(files => {
      const module = require('core/store.js'), store = module.getStore(), disk = {}, original = { ...store };
      const isolated = module.createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
      const date = require('core/date.js').key(), photos = { originalPath: files[0], subjectPath: files[1], width: 600, height: 240, kind: 'extracted' };
      const id = isolated.add('round1', date, photos); isolated.commit(s => { s.localNoticeSeen = true; });
      getApp().__round1 = { original, id, date, file: files[1], photos }; Object.assign(store, isolated);
      const p = getCurrentPages().slice(-1)[0]; p.setData({ editable: false, selected: '' }); p.refresh();
    }, files);
    let page = await mini.currentPage(); await (await page.$('#record-today')).tap();
    await layout(['#record-card'], ['.record-card', '#close-record', '#record-camera', '#record-album'], 'record sources');
    await mini.evaluate(() => {
      const q = getApp().__round1, card = getCurrentPages().slice(-1)[0].selectComponent('#record-card');
      card.photoDone(q.id); card.photoNoteId = q.id;
      card.photoTask = { savedId: q.id, committed: true, originalPath: q.photos.originalPath, subjectPath: q.file, kind: 'extracted' };
      card.setData({ task: { state: 'done', committed: true, original: q.photos.originalPath, subject: q.file, kind: 'extracted' } });
    });
    await layout(['#record-card', '#record-photo'], ['#task-preview', '#continue-layout', '#adjust-photo'], 'result actions');
    await act(['#record-card'], 'openPhotoNote'); await keyboard(['#record-card'], 260);
    await layout(['#record-card'], ['.record-card', '#close-record'], 'record keyboard container');
    // The child has no modalHeight of its own: check against the parent's visible height.
    const note = await mini.evaluate(() => new Promise(resolve => {
      const c = getCurrentPages().slice(-1)[0].selectComponent('#record-card'), panel = c.selectComponent('#record-photo');
      panel.createSelectorQuery().select('#photo-note-input').boundingClientRect().select('#continue-layout').boundingClientRect().exec(items => resolve({ items, height: c.data.modalHeight }));
    }));
    note.items.forEach(r => assert.ok(r && r.height >= 44 && r.bottom <= note.height + 1, 'note and continue stay above keyboard'));
    await keyboard(['#record-card'], 0);
    const card = await page.$('#record-card'), panel = await card.$('#record-photo');
    await pause(350); await (await panel.$('#compare-photo')).tap();
    await keyboard(['#record-card'], 260);
    await (await panel.$('#continue-layout')).tap();
    await keyboard(['#record-card'], 0);
    let active = false; const phases = [], started = Date.now();
    await until(async () => {
      const state = await mini.evaluate(() => {
        const p = getCurrentPages().slice(-1)[0], f = p.selectComponent('#placement-flight');
        return { active: !!p.data.placing, phase: f && f.data.phase, target: p.data.placing && p.data.placing.target,
          source: p.data.placing && p.data.placing.source };
      });
      if (state.active) { active = true; phases.push({ ms: Date.now() - started, ...state }); }
      return active && !state.active;
    }, 'short peel and landing');
    assert.ok(phases.some(p => p.phase === 'peeling')); assert.ok(phases.some(p => p.phase === 'flying'));
    assert.ok(phases.some(p => p.target)); assert.ok(Date.now() - started < 4000, 'normal handoff must not wait for the 6s fallback');
    assert.ok(Math.abs(phases[0].source.width / phases[0].source.height - 2.5) < .01);
    fs.writeFileSync(path.join(output, 'flight-' + (await mini.systemInfo()).windowWidth + '.json'), JSON.stringify(phases, null, 2)); checks.push('short flight reaches real target without duplicate');
    const id = await mini.evaluate(() => getApp().__round1.id);
    await act([], 'openMemory', { detail: { id } });
    await until(async () => !!await page.$('#memory-card'), 'memory card');
    await act(['#memory-card'], 'flip'); await act(['#memory-card'], 'edit');
    await act(['#memory-card'], 'input', { detail: { value: '键盘与短屏验收。'.repeat(35) } });
    await keyboard(['#memory-card'], 260);
    await layout(['#memory-card'], ['.memory-card-dialog', '#close-memory-card', '#card-note-input', '#save-card-note'], 'memory keyboard controls');
    await keyboard(['#memory-card'], 0); await act(['#memory-card'], 'close');
    await until(async () => !await page.$('#memory-card'), 'memory exit');
    await act([], 'exportToday');
    await until(async () => { const c = await page.$('#share-card'); return c && (await c.data()).imagePath; }, 'share export');
    await layout(['#share-card'], ['.share-card-dialog', '#close-share-card', '.share-card-preview', '#share-image', '#save-album'], 'share controls');
    await act(['#share-card'], 'close'); await until(async () => !await page.$('#share-card'), 'share exit');
    await mini.callWxMethod('switchTab', { url: '/pages/calendar/index' }); page = await mini.currentPage();
    const date = await mini.evaluate(() => getApp().__round1.date); await act([], 'open', { currentTarget: { dataset: { date } } });
    await layout(['#day-board-card'], ['.day-board-dialog', '#close-day-board', '.day-board-stage'], 'date board');
    await act(['#day-board-card'], 'memory', { detail: { id } });
    await until(async () => { const c = await page.$('#day-board-card'); return c && !!await c.$('#memory-card'); }, 'nested memory');
    await act(['#day-board-card', '#memory-card'], 'close');
    await until(async () => { const c = await page.$('#day-board-card'); return c && !(await c.data()).memoryCardId; }, 'nested exit');
    assert.equal((await page.data()).boardDate, date);
    await act(['#day-board-card'], 'close'); await until(async () => !(await page.data()).boardDate, 'date exit');
    checks.push('nested close retains calendar date'); assert.deepEqual(errors, []);
  } finally {
    if (mini) {
      if (installed) await mini.evaluate(() => {
        const q = getApp().__round1; if (!q) return;
        for (const p of getCurrentPages()) {
          for (const selector of ['#record-card', '#day-board-card', '#memory-card']) {
            const c = p.selectComponent(selector); if (c) { c.dirty = false; c.noteDirty = false; if (c.photoTask) c.photoTask.committed = true; }
          }
          p.dirty = false; p.noteDirty = false;
          p.setData({ editable: false, selected: '', layoutSaved: false, editorOpen: false, memoryCardId: '', shareBoardId: '', boardDate: '' });
        }
      });
      await pause(250);
      if (installed) await mini.evaluate(() => {
        const q = getApp().__round1; if (!q) return;
        Object.assign(require('core/store.js').getStore(), q.original); delete getApp().__round1;
        getCurrentPages().forEach(p => { p.dirty = false; if (p.refresh) p.refresh(); });
        if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({});
      });
      for (const file of files) await mini.evaluate(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }, file);
      if (backup) assert.deepEqual(await snapshot(), backup, 'user storage unchanged');
      await mini.callWxMethod('switchTab', { url: '/pages/index/index' });
      const info = await mini.systemInfo(); mini.disconnect();
      fs.writeFileSync(path.join(output, 'ui-' + info.windowWidth + '.json'), JSON.stringify({ passed: checks.length >= 7 && !errors.length, info, checks, rects, errors, userStorageUnchanged: true,
        limitations: ['Keyboard events injected into the registered presentation handler; physical keyboard still requires remote-debug acceptance'] }, null, 2));
    }
  }
  console.log('PASS:', checks.join('; '));
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
