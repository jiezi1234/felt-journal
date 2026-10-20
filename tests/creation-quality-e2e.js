// Uses an in-memory store adapter and synthetic images; never replaces the user's
// journal storage or calls App.onLaunch while the adapter is installed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const automator = require('miniprogram-automator');
const output = path.resolve('artifacts/creation-quality');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function sample(background) {
  const c = createCanvas(400, 300), x = c.getContext('2d');
  if (background) { x.fillStyle = '#E4CFA9'; x.fillRect(0, 0, 400, 300); }
  x.beginPath(); x.ellipse(200, 150, 115, 95, 0, 0, Math.PI * 2); x.fillStyle = '#FFFFFF'; x.fill();
  x.beginPath(); x.ellipse(200, 150, 102, 82, 0, 0, Math.PI * 2); x.fillStyle = '#A1603F'; x.fill();
  x.fillStyle = '#EAC99C'; x.fillRect(150, 110, 100, 60); return c.toBuffer('image/png').toString('base64');
}
(async () => {
  let mini, before, installed = false, originalRoute;
  const checks = [], errors = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
  async function wait(target, predicate, label) {
    for (let i = 0; i < 160; i++) { const data = await target.data(); if (predicate(data)) return data; await pause(100); }
    throw Error('Timed out: ' + label);
  }
  async function onRoute(route) {
    for (let i = 0; i < 100; i++) { const p = await mini.currentPage(); if (p && p.path === route) return p; await pause(100); }
    throw Error('Route did not open: ' + route);
  }
  const choices = values => mini.evaluate(values => { getApp().__creationQuality.choices = values; }, values);
  const state = () => mini.evaluate(() => require('core/store.js').getStore().get());
  async function waitPicker(count) {
    for (let i = 0; i < 100; i++) {
      if (await mini.evaluate(() => getApp().__creationQuality.pickCount) >= count) return;
      await pause(100);
    }
    throw Error('Replacement picker did not run');
  }
  async function capture(name) { await pause(350); await mini.screenshot({ path: path.join(output, name + '.png') }); }
  async function crop(home, card) {
    const old = (await card.data()).task.subject;
    await choices([0]); await (await (await card.$('#record-photo')).$('#adjust-photo')).tap();
    const p = await onRoute('pages/photo-edit/index'); await wait(p, d => d.ready && !d.loading, 'crop canvas');
    assert.equal((await p.data()).fromResult, true);
    await (await p.$('#ratio-1')).tap(); await (await p.$('#save-image')).tap();
    await onRoute('pages/index/index'); card = await home.$('#record-card');
    await wait(card, d => d.task && d.task.state === 'done' && d.task.subject !== old, 'cropped result returns');
    return card;
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', error => errors.push(error));
    fs.mkdirSync(output, { recursive: true }); before = await snapshot();
    originalRoute = await mini.evaluate(() => {
      const p = getCurrentPages().slice(-1)[0];
      if (!p || !['pages/index/index', 'pages/board-tab/index', 'pages/calendar/index'].includes(p.route)) throw Error('Start from an idle tab');
      for (const page of getCurrentPages()) if (page.dirty || page.noteDirty || page.photoTask || page.data.editorOpen || page.data.drawer || page.data.memoryCardId || page.data.shareBoardId || page.data.boardDate || page.data.formOpen) throw Error('Finish current work before acceptance');
      return '/' + p.route;
    });
    await mini.callWxMethod('switchTab', { url: '/pages/index/index' });
    const home = await onRoute('pages/index/index'); await wait(home, d => !d.loading, 'home');
    installed = true;
    await mini.evaluate((originalBytes, subjectBytes) => {
      const storeModule = require('core/store.js'), store = storeModule.getStore(), platform = require('services/platform.js'), extraction = require('services/extraction.js');
      const q = getApp().__creationQuality = { originalStore: { ...store }, platform: { choose: platform.choose, call: platform.call, persist: platform.persist }, extract: extraction.extract, choices: [], pickCount: 0, files: [], protectedFiles: Object.values(store.get().memories).flatMap(m => [m.originalPath, m.subjectPath]) };
      q.original = `${wx.env.USER_DATA_PATH}/creation-quality-${Date.now()}-original.png`;
      q.subject = `${wx.env.USER_DATA_PATH}/creation-quality-${Date.now()}-subject.png`;
      wx.getFileSystemManager().writeFileSync(q.original, originalBytes, 'base64');
      wx.getFileSystemManager().writeFileSync(q.subject, subjectBytes, 'base64'); q.files.push(q.original, q.subject);
      const disk = {}, isolated = storeModule.createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
      isolated.commit(s => { s.localNoticeSeen = true; });
      const date = require('core/date.js').key();
      q.seed = isolated.add('quality_seed', date, { originalPath: q.original, subjectPath: q.subject, width: 400, height: 300, kind: 'extracted' });
      Object.assign(store, isolated);
      platform.choose = async () => { q.pickCount++; if (q.cancelPicker) { q.cancelPicker = false; throw { errMsg: 'chooseMedia:fail cancel' }; } return { path: q.original, width: 400, height: 300 }; };
      platform.persist = async (file, name) => { const result = await q.platform.persist(file, name); q.files.push(result); return result; };
      platform.call = (name, options) => {
        if (name === 'showActionSheet') { if (!q.choices.length) return Promise.reject(Error('No test menu choice')); return Promise.resolve({ tapIndex: q.choices.shift() }); }
        return q.platform.call(name, options);
      };
      extraction.extract = async (_, task, stage) => { stage('uploading'); stage('extracting'); return q.subject; };
      getCurrentPages().slice(-1)[0].refresh();
    }, sample(true), sample(false));
    console.log('STEP: isolated in-memory board ready');
    await wait(home, d => d.count === 1, 'isolated board');
    const seed = (await home.data()).model.items[0];
    await (await home.$('#record-today')).tap(); await wait(home, d => d.editorOpen, 'record card');
    let card = await home.$('#record-card'); await wait(card, d => !d.loading, 'record ready');
    await (await card.$('#record-album')).tap(); await wait(card, d => d.task && d.task.state === 'done', 'automatic result');
    const id = (await card.data()).selected, originalLayout = (await state()).boards[(await home.data()).date].placements;
    assert.equal(Object.keys((await state()).memories).length, 2);
    const next = originalLayout.find(p => p.memoryId === id);
    assert.ok(Math.abs(next.x - seed.x) >= (next.width + seed.width) / 2 || Math.abs(next.y - seed.y) >= (next.height + seed.height) / 2);
    await card.callMethod('photoNoteInput', { detail: { value: '今天的小收藏' } });
    await capture('01-result'); card = await crop(home, card);
    assert.equal((await state()).memories[id].text, '今天的小收藏');
    assert.deepEqual((await state()).boards[(await home.data()).date].placements, originalLayout);
    await capture('02-cropped-result'); checks.push('Crop opens from the result and returns to the same card with caption and layout intact');
    console.log('STEP: crop returned with caption and layout');
    await choices([1]); await (await (await card.$('#record-photo')).$('#adjust-photo')).tap();
    await wait(card, d => !d.photoAdjusting && d.task.kind === 'original', 'keep original');
    card = await crop(home, card);
    const originalPanel = await card.$('#record-photo');
    assert.equal((await originalPanel.data()).displayImage, (await card.data()).task.subject);
    assert.equal((await state()).memories[id].width, (await state()).memories[id].height);
    checks.push('Keeping the original preserves its background; cropping it previews the edited image');
    const accepted = (await card.data()).task.subject;
    await mini.evaluate(() => { getApp().__creationQuality.cancelPicker = true; });
    await choices([2, 0]); await (await (await card.$('#record-photo')).$('#adjust-photo')).tap();
    await waitPicker(2);
    await wait(card, d => !d.photoAdjusting && d.task && d.task.state === 'done', 'cancel replacement');
    assert.equal((await card.data()).task.subject, accepted); assert.equal(Object.keys((await state()).memories).length, 2);
    await choices([2, 0]); await (await (await card.$('#record-photo')).$('#adjust-photo')).tap();
    await waitPicker(3);
    await wait(card, d => d.task && d.task.state === 'done' && d.task.subject !== accepted, 'replacement');
    assert.equal((await card.data()).selected, id); assert.equal(Object.keys((await state()).memories).length, 2);
    assert.equal((await state()).memories[id].text, '今天的小收藏');
    assert.deepEqual((await state()).boards[(await home.data()).date].placements, originalLayout);
    checks.push('Cancel keeps the accepted result; replacing updates the same memory and preserves all placements');
    console.log('STEP: result adjustment and replacement passed');
    await (await (await card.$('#record-photo')).$('#continue-layout')).tap();
    await wait(home, d => !d.editorOpen && !d.placing && d.count === 2, 'landing animation');
    await (await home.$('#finish-today')).tap(); await capture('03-auto-placement');
    const board = await home.$('#today-board'); const screen = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#today-board').exportViewport());
    await (await home.$('#export-today')).tap(); await wait(home, d => !!d.shareBoardId, 'share opens');
    const share = await home.$('#share-card'); let exported = await wait(share, d => !d.generating && !!d.imagePath, 'share image');
    const info = await mini.callWxMethod('getImageInfo', { src: exported.imagePath });
    assert.equal(Math.max(info.width, info.height), 1800); assert.ok(Math.abs(info.width / info.height - screen.width / screen.height) < 0.001);
    assert.equal((await board.data()).covered, true); await capture('04-matching-share');
    await (await share.$('#share-appearance')).tap(); await wait(share, d => d.styleOpen, 'appearance drawer');
    await (await share.$('#share-texture-cross')).tap();
    await wait(share, d => !d.generating && d.previewTexture === 'cross', 'share appearance');
    assert.deepEqual((await state()).boards[(await home.data()).date].placements, originalLayout);
    await (await share.$('#close-share-style')).tap(); await (await share.$('#close-share-card')).tap();
    checks.push('Today landing and portrait export use the same board composition; share decoration leaves records unchanged');
    console.log('STEP: matching portrait share passed');
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(errors, [], 'No unhandled runtime exceptions');
  } finally {
    if (mini) {
      try {
        if (installed) {
          let current = await mini.currentPage();
          if (current && current.path === 'pages/photo-edit/index') await mini.navigateBack();
          await mini.evaluate(() => {
            const p = getCurrentPages().slice(-1)[0];
            if (p) p.setData({ editorOpen: false, memoryCardId: '', shareBoardId: '', placing: null });
          }); await pause(300);
          await mini.evaluate(() => {
            const q = getApp().__creationQuality; if (!q) return;
            const store = require('core/store.js').getStore(); Object.assign(store, q.originalStore);
            Object.assign(require('services/platform.js'), q.platform); require('services/extraction.js').extract = q.extract;
            store.load();
            for (const file of q.files) {
              if (!file.startsWith(wx.env.USER_DATA_PATH + '/') || q.protectedFiles.includes(file)) throw Error('Refuse to remove a protected file');
              try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {}
            }
            delete getApp().__creationQuality;
            const p = getCurrentPages().slice(-1)[0]; if (p) { p.dirty = false; p.history = null; p.refresh(); }
            if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({});
          });
        }
        if (before) assert.deepEqual(await snapshot(), before, 'Actual user storage must remain unchanged');
        if (originalRoute) await mini.callWxMethod('switchTab', { url: originalRoute });
      } finally { mini.disconnect(); }
    }
  }
  fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ passed: true, userStorageUnchanged: true, checks, limitations: ['Synthetic images; picker, action-sheet choices and extraction mocked', 'Real native crop/export canvases and landing animation; physical-device gestures not covered'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
