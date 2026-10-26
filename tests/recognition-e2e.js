/* Recognition UI acceptance in the real WeChat runtime. The system picker is
 * mocked with a test photo; upload, extraction, download and saving are real.
 * Set WECHAT_EXTRACTION_ENDPOINT to an opt-in loopback test service.
 * Run alone: this temporarily isolates, then restores journal storage. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const endpoint = process.env.WECHAT_EXTRACTION_ENDPOINT;
const fixture = process.env.WECHAT_TEST_PHOTO;
const output = path.resolve(process.env.WECHAT_RECOGNITION_OUTPUT || 'artifacts/recognition-ui');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  assert.ok(endpoint && /^http:\/\/127\.0\.0\.1:\d+\/extract$/.test(endpoint), 'Set a loopback extraction endpoint');
  assert.ok(fixture && fs.existsSync(fixture), 'Set WECHAT_TEST_PHOTO to a test photo');
  fs.mkdirSync(output, { recursive: true });
  let mini, backup, testPhoto, isolated = false, restored = false;
  const errors = [], checks = [], screenshots = [], states = [];
  async function wait(target, predicate, timeout = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const data = await target.data();
      if (data.task && states.at(-1) !== data.task.state) states.push(data.task.state);
      if (predicate(data)) return data;
      await pause(80);
    }
    throw new Error(`Timed out waiting for recognition state: ${JSON.stringify(await target.data())}`);
  }
  async function capture(name) {
    if (process.env.WECHAT_SCREENSHOTS !== '1') return;
    await mini.screenshot({ path: path.join(output, name + '.png') }); screenshots.push(name);
  }
  async function readState() { return JSON.parse(await mini.callWxMethod('getStorageSync', keys[0])); }
  async function route(name) {
    const start = Date.now();
    while (Date.now() - start < 15000) { const page = await mini.currentPage(); if (page.path === `pages/${name}/index`) return page; await pause(100); }
    throw new Error(`Did not reach ${name}`);
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', error => errors.push(error));
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    fs.mkdirSync(path.resolve('artifacts'), { recursive: true });
    fs.writeFileSync(path.resolve('artifacts/recognition-storage-backup.json'), JSON.stringify(backup));
    await mini.evaluate((names, url) => {
      names.forEach(key => wx.removeStorageSync(key));
      wx.setStorageSync(names[0], JSON.stringify({ version: 1, revision: 0, boards: {}, memories: {}, operations: {}, garbage: [], localNoticeSeen: true }));
      wx.setStorageSync(names[3], url);
    }, keys, endpoint); isolated = true;
    testPhoto = await mini.evaluate(bytes => {
      const file = `${wx.env.USER_DATA_PATH}/felt-recognition-acceptance.png`;
      wx.getFileSystemManager().writeFileSync(file, bytes, 'base64'); return file;
    }, fs.readFileSync(fixture).toString('base64'));
    await mini.mockWxMethod('chooseMedia', { tempFiles: [{ tempFilePath: testPhoto, size: fs.statSync(fixture).size, fileType: 'image' }], type: 'image' });
    const home = await mini.reLaunch('/pages/index/index'); await wait(home, data => !data.loading);
    const homeId = home.id;
    await (await home.$('#record-today')).tap(); await wait(home, data => data.editorOpen);
    let card = await home.$('#record-card'); await wait(card, data => !data.loading);
    await capture('01-start');
    const sourceSize = await (await card.$('.record-card')).size();
    await (await card.$('#record-album')).tap();
    console.log('STEP: photo selection automatically sent to actual service');
    await wait(card, data => data.task && ['uploading', 'extracting', 'saving', 'done'].includes(data.task.state));
    if ((await card.data()).task.state !== 'done') {
      await capture('03-processing-a'); await pause(220); await capture('03-processing-b');
    }
    const result = await wait(card, data => data.task && data.task.state === 'done' && data.count === 0, 90000);
    const resultSize = await (await card.$('.record-card')).size();
    assert.ok(Math.abs(sourceSize.height - resultSize.height) < 2, 'Selection and processing remain in the same sized card');
    assert.equal(await card.$('#board'), null, 'Photo card never contains another felt board');
    let panel = await card.$('#record-photo');
    assert.equal(await panel.$('#start-extraction'), null);
    assert.equal(states.includes('preview'), false);
    checks.push('selecting a photo starts processing automatically in the same card without a start button');
    assert.equal(result.task.committed, true); assert.equal(result.task.kind, 'extracted');
    const id = await mini.evaluate(() => getCurrentPages().at(-1).selectComponent('#record-card').photoNoteId), saved = (await readState()).memories[id];
    assert.ok(id && saved); assert.equal(saved.kind, 'extracted');
    assert.notEqual(saved.subjectPath, saved.originalPath);
    const imageBytes = Buffer.from(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), saved.subjectPath), 'base64');
    fs.writeFileSync(path.join(output, 'actual-cutout.png'), imageBytes);
    const image = await loadImage(imageBytes), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let transparent = 0, opaque = 0, white = 0;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] === 0) transparent++; if (pixels[i] === 255) opaque++;
      if (pixels[i] === 255 && pixels[i - 1] >= 225 && pixels[i - 2] >= 225 && pixels[i - 3] >= 225) white++;
    }
    assert.ok(transparent > 0 && opaque > 0, 'Actual saved result must contain both transparent and foreground pixels');
    assert.ok(white > 200, 'Saved sticker retains its opaque, light textured decoration');
    await pause(1100); assert.equal((await card.data()).task.state, 'done');
    panel = await card.$('#record-photo');
    await (await panel.$('#compare-photo')).tap(); await wait(panel, data => data.showOriginal);
    assert.equal((await panel.data()).displayImage, saved.originalPath);
    await (await panel.$('#compare-photo')).tap(); await wait(panel, data => !data.showOriginal);
    assert.equal((await panel.data()).displayImage, saved.subjectPath);
    assert.equal((await readState()).memories[id].subjectPath, saved.subjectPath);
    await capture('04-complete');
    console.log('STEP: actual transparent PNG saved; completion remains visible');
    assert.equal((await mini.currentPage()).id, homeId); assert.equal((await mini.pageStack()).length, 1);
    console.log('STEP: home identity and stack verified');
    panel = await card.$('#record-photo');
    const continueButton = await panel.$('#continue-layout');
    assert.ok(continueButton, 'Continue button renders after saved completion');
    console.log('STEP: completion button found');
    await continueButton.tap();
    await wait(home, data => !!data.placing);
    await capture('04-peeling');
    const flight = await wait(home, data => !data.editorOpen && data.placing && data.placing.target);
    assert.equal(flight.placing.id, id);
    assert.ok(flight.placing.target.width < flight.placing.source.width, 'Sticker shrinks from preview to the board');
    const board = await home.$('#today-board');
    assert.equal((await board.data()).landingId, id);
    await capture('05-flying');
    await wait(home, data => !data.placing && !data.editorOpen);
    assert.equal((await board.data()).landingId, '');
    assert.equal(Object.keys((await readState()).memories).length, 1);
    assert.equal(await home.$('#record-card'), null); assert.equal((await home.data()).editable, true);
    checks.push('Start arranging closes the photo card and flies onto the existing Today board, with one record and editable landing');
    checks.push('real upload/extraction/download produces a transparent saved PNG; original/result comparison preserves the saved file; done persists until continue; same home and one commit');
    await capture('05-arrange');
    const boardPng = await mini.evaluate(() => new Promise((resolve, reject) => {
      const board = getCurrentPages().at(-1).selectComponent('#today-board');
      wx.canvasToTempFilePath({ canvas: board.canvas, fileType: 'png', success: result => {
        const fs = wx.getFileSystemManager();
        try { resolve(fs.readFileSync(result.tempFilePath, 'base64')); } catch (error) { reject(error); }
      }, fail: reject });
    }));
    fs.writeFileSync(path.join(output, 'actual-board-canvas.png'), Buffer.from(boardPng, 'base64'));
    console.log('STEP: continued to arrangement on the same home page');
    const originalPlacement = (await readState()).boards[saved.date].placements[0];
    await home.callMethod('transform', { detail: { op: 'cw' } });
    assert.notEqual((await readState()).boards[saved.date].placements[0].angle, originalPlacement.angle);
    await home.callMethod('undo');
    assert.deepEqual((await readState()).boards[saved.date].placements[0], originalPlacement);
    const center = () => mini.evaluate(() => new Promise(resolve => {
      const b = getCurrentPages().at(-1).selectComponent('#today-board');
      b.createSelectorQuery().select('.board-shell').boundingClientRect(r => {
        const item = b.displayModel.items[0], scale = r.width / 1500;
        resolve({ x: r.left + (item.x + 45) * scale, y: r.top + (item.y + 45) * scale });
      }).exec();
    }));
    const startCenter = await center(), shell = await board.$('.board-shell');
    const finger = { identifier: 0, clientX: startCenter.x, clientY: startCenter.y };
    await shell.touchstart({ touches: [finger] }); await pause(150);
    await shell.touchmove({ touches: [{ ...finger, clientY: finger.clientY + 24 }] });
    await shell.touchend({ touches: [] }); await pause(250);
    const endCenter = await center();
    assert.ok(Math.abs(endCenter.y - startCenter.y - 24) < 1, 'Portrait board drag follows the finger without vertical stretching');
    await home.callMethod('undo');
    assert.deepEqual((await readState()).boards[saved.date].placements[0], originalPlacement);
    const beforeShare = JSON.stringify(await readState());
    await (await home.$('#export-today')).tap();
    const share = await route('export'); await wait(share, d => !d.generating && !!d.imagePath);
    const firstImage = (await share.data()).imagePath;
    await (await share.$('#share-color-1')).tap(); await wait(share, d => !d.generating && !!d.imagePath && d.imagePath !== firstImage);
    await (await share.$('#share-texture-cross')).tap(); await wait(share, d => !d.generating && d.previewTexture === 'cross');
    assert.equal(JSON.stringify(await readState()), beforeShare);
    await capture('06-share-style'); await share.callMethod('back'); await route('index');
    checks.push('Today supports rotation, exact-distance portrait dragging and undo; color/texture choices exist only on share and never change saved board data');
    await (await home.$('#record-today')).tap(); await wait(home, data => data.editorOpen);
    card = await home.$('#record-card'); await wait(card, data => !data.loading);
    assert.equal((await card.data()).task, null);
    await (await card.$('#record-album')).tap();
    await wait(card, data => data.task && ['uploading', 'extracting'].includes(data.task.state));
    await card.callMethod('cancelPhoto'); await wait(card, data => !data.task);
    await pause(1500); assert.equal(Object.keys((await readState()).memories).length, 1);
    checks.push('reopening has no residual state; cancelling a real request does not create a second memory');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    if (mini) {
      await mini.restoreWxMethod('chooseMedia').catch(() => {});
      if (backup) {
        await mini.evaluate(() => { const page = getCurrentPages().slice(-1)[0]; if (page && page.data.editorOpen) page.setData({ editorOpen: false }); }); await pause(300);
        if (isolated) await mini.evaluate(key => {
          const raw = wx.getStorageSync(key); if (!raw) return;
          const state = JSON.parse(raw), paths = Object.values(state.memories).flatMap(memory => [memory.originalPath, memory.subjectPath]).concat(state.garbage || []);
          for (const file of paths) if (file.startsWith(`${wx.env.USER_DATA_PATH}/felt-journal/`)) { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }
        }, keys[0]);
        await mini.evaluate(items => items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)), backup);
        assert.deepEqual(await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys), backup); restored = true;
      }
      if (testPhoto) await mini.evaluate(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }, testPhoto);
      await mini.evaluate(() => { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({}); });
      await mini.reLaunch('/pages/index/index').catch(() => {}); mini.disconnect();
      fs.writeFileSync(path.join(output, 'cleanup.json'), JSON.stringify({ storageRestored: restored, at: new Date().toISOString() }, null, 2));
    }
  }
  fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), storageRestored: restored, states, checks, screenshots, limitations: ['System photo picker uses a test fixture', 'Loopback test endpoint; public HTTPS and physical phone not verified', 'DevTools screenshots can misplace native Canvas layers; actual-board-canvas.png is the direct Canvas export', 'Animation screenshots are samples, not frame-accurate comparison with the original APK'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
