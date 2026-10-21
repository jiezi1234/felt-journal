/* Native export/share UI acceptance. Sharing and album APIs are mocked: no
 * message is sent and no real album write occurs. Storage is restored in finally.
 * Do not edit/recompile the mini-program during the isolated test. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1'];
const output = path.resolve(__dirname, '../artifacts');
(async () => {
  let mini, backup, files = [], exportedFiles = [];
  const errors = [], checks = [], screenshots = [];
  async function wait(page, predicate) {
    const start = Date.now();
    while (Date.now() - start < 15000) { const data = await page.data(); if (predicate(data)) return data; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw new Error(`Timed out on ${page.path}: ${JSON.stringify(await page.data())}`);
  }
  async function route(expected) {
    const start = Date.now();
    while (Date.now() - start < 15000) { const page = await mini.currentPage(); if (page && page.path === expected) return page; await new Promise(resolve => setTimeout(resolve, 150)); }
    throw new Error(`Did not reach ${expected}`);
  }
  async function capture(name) {
    if (process.env.WECHAT_SCREENSHOTS !== '1') return;
    await mini.callWxMethod('hideToast', {});
    await mini.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 }); await new Promise(resolve => setTimeout(resolve, 800));
    try { await mini.screenshot({ path: path.join(output, name) }); screenshots.push(name); }
    catch (error) { console.warn(`Screenshot skipped (${name}): ${error.message}`); }
  }
  async function share(page, expectedCalls) {
    await (await page.$('#share-image')).tap();
    const started = Date.now();
    while (Date.now() - started < 10000) {
      const data = await page.data(), calls = await mini.evaluate(() => getApp().__feltShareE2E);
      if (data.error || data.shareError || !data.shareSupported) throw new Error(`Share failed: ${JSON.stringify(data)}`);
      if (calls.length === expectedCalls && !data.sharing) return calls;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`No sharing handoff: ${JSON.stringify(await page.data())}`);
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', error => errors.push(error)); fs.mkdirSync(output, { recursive: true });
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    const fixture = createCanvas(160, 160), ctx = fixture.getContext('2d');
    ctx.fillStyle = '#4D7D5B'; ctx.beginPath(); ctx.ellipse(80, 80, 42, 65, .45, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#F7F2E9'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(48, 140); ctx.lineTo(106, 26); ctx.stroke();
    files = await mini.evaluate(stamp => ['original', 'subject'].map(kind => `${wx.env.USER_DATA_PATH}/felt-share-e2e-${stamp}-${kind}.png`), `${Date.now()}-${process.pid}`);
    await mini.evaluate((paths, bytes) => paths.forEach(file => wx.getFileSystemManager().writeFileSync(file, bytes, 'base64')), files, fixture.toBuffer('image/png').toString('base64'));
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } }), date = dates.key();
    for (let i = 0; i < 2; i++) {
      const id = store.add(`share_${i}`, date, { originalPath: files[0], subjectPath: files[1], width: 160, height: 160, kind: 'extracted' });
      store.edit(id, '这段详情文字不应作为分享参数发送', '自然');
    }
    store.commit(state => {
      state.localNoticeSeen = true; const board = state.boards[date]; board.color = '#C3D0BD'; board.texture = 'cross';
      board.placements.forEach((item, i) => { item.x = 470 + i * 500; item.y = 460; item.angle = i * 30; });
    });
    const seeded = disk[keys[0]];
    await mini.evaluate((names, snapshot) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], snapshot); getApp().__feltShareE2E = []; }, keys, seeded);
    await mini.mockWxMethod('showShareImageMenu', function(options) { getApp().__feltShareE2E.push(options); return { errMsg: 'showShareImageMenu:ok' }; });
    await mini.mockWxMethod('saveImageToPhotosAlbum', { errMsg: 'saveImageToPhotosAlbum:ok' });
    const home = await mini.reLaunch('/pages/index/index'); await wait(home, data => !data.loading);
    const board = await mini.navigateTo(`/pages/board/index?date=${date}`); await wait(board, data => !data.loading);
    await board.callMethod('exportBoard'); const page = await board.$('#share-card');
    let data = await wait(page, value => !value.generating); assert.equal(data.error, ''); assert.ok(data.imagePath); assert.equal(data.count, 2); assert.equal(data.shareSupported, true);
    exportedFiles.push(data.imagePath); const firstImage = data.imagePath;
    const info = await mini.callWxMethod('getImageInfo', { src: firstImage }); assert.deepEqual([info.width, info.height], [1800, 1392]);
    fs.writeFileSync(path.join(output, 'wechat-share-board.png'), Buffer.from(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), firstImage), 'base64'));
    console.log('STEP: genuine native Canvas export ready; testing mocked sharing handoff');
    await capture('wechat-share-export.png');
    assert.deepEqual(await share(page, 1), [{ path: firstImage, needShowEntrance: false }]);
    assert.equal((await page.data()).albumSaved, false); assert.equal((await page.data()).shareError, '');
    checks.push('native board -> in-place share card and 1800x1392 Canvas PNG including clamp; share button passes exact preview path and disables app entry');
    await (await page.$('#save-album')).tap(); await wait(page, value => value.albumSaved);
    await share(page, 2); assert.equal((await page.data()).albumSaved, true);
    checks.push('sharing does not claim delivery or album save; separate album callback controls saved status');
    console.log('STEP: native sharing handoff and album status verified; checking fallback UI and regeneration');
    // canIUse is not mockable through this automator version. Capability logic is
    // covered by unit tests; inject its result here to inspect native fallback UI.
    await page.setData({ shareSupported: false });
    assert.equal((await page.data()).shareSupported, false); assert.ok(await page.$('#share-unavailable'));
    assert.equal(String(await (await page.$('#share-image')).attribute('disabled')), 'true');
    assert.equal(String(await (await page.$('#save-album')).attribute('disabled')), 'false');
    await capture('wechat-share-unavailable.png'); await page.callMethod('refreshShareSupport');
    checks.push('injected unsupported state shows fallback and leaves album saving enabled');
    // DevTools Canvas temporary files are readable but cannot be unlinked. Use
    // an exact export copy in our own namespace to exercise a genuinely lost file.
    const expiredCopy = files[0].replace(/-original\.png$/, '-expired.png'); files.push(expiredCopy);
    await mini.evaluate((source, destination) => wx.getFileSystemManager().copyFileSync(source, destination), firstImage, expiredCopy);
    await page.setData({ imagePath: expiredCopy });
    await mini.evaluate(file => wx.getFileSystemManager().unlinkSync(file), expiredCopy);
    await (await page.$('#share-image')).tap(); data = await wait(page, value => value.imageExpired); assert.match(data.error, /重新生成/);
    assert.equal((await mini.evaluate(() => getApp().__feltShareE2E)).length, 2);
    await (await page.$('#regenerate-image')).tap(); data = await wait(page, value => !value.generating && !value.imageExpired && !!value.imagePath);
    exportedFiles.push(data.imagePath); assert.equal(data.error, ''); assert.equal(data.albumSaved, false);
    assert.equal((await share(page, 3)).at(-1).path, data.imagePath);
    assert.equal(await mini.callWxMethod('getStorageSync', keys[0]), seeded);
    checks.push('expired temporary image blocks sharing, regenerates and shares new preview; original journal snapshot stays unchanged');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    if (mini) {
      for (const name of ['showShareImageMenu', 'saveImageToPhotosAlbum']) await mini.restoreWxMethod(name).catch(() => {});
      if (backup) await mini.evaluate(items => items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)), backup);
      await mini.evaluate(paths => { paths.forEach(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }); delete getApp().__feltShareE2E; }, [...files, ...new Set(exportedFiles)]);
      await mini.reLaunch('/pages/index/index').catch(() => {}); mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output, 'wechat-share-e2e.json'), JSON.stringify({ passed: true, recordedAt: new Date().toISOString(), checks, screenshots,
    limitations: ['Synthetic isolated board', 'WeChat image-sharing and album APIs mocked; no message sent or album write', 'Unsupported state injected for UI inspection; capability detection covered by unit tests', 'Actual recipient selection, delivery, client compression and phone compatibility pending device acceptance'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
