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
    await (await card.$('#record-album')).tap(); await wait(card, data => data.task && data.task.state === 'preview');
    let panel = await card.$('#record-photo');
    assert.ok(await panel.$('#start-extraction'));
    assert.equal(Object.keys((await readState()).memories).length, 0);
    await capture('02-preview');
    await card.callMethod('cancelPhoto'); await wait(card, data => !data.task);
    assert.equal(Object.keys((await readState()).memories).length, 0);
    checks.push('preview waits for an explicit start; cancelling preview creates no record');
    await (await card.$('#record-album')).tap(); await wait(card, data => data.task && data.task.state === 'preview');
    panel = await card.$('#record-photo');
    await (await panel.$('#start-extraction')).tap();
    console.log('STEP: explicit start sent to actual service');
    await wait(card, data => data.task && ['uploading', 'extracting', 'saving', 'done'].includes(data.task.state));
    if ((await card.data()).task.state !== 'done') {
      await capture('03-processing-a'); await pause(220); await capture('03-processing-b');
    }
    const result = await wait(card, data => data.task && data.task.state === 'done' && data.count === 1, 90000);
    assert.equal(result.task.committed, true); assert.equal(result.task.kind, 'extracted');
    const id = result.selected, saved = (await readState()).memories[id];
    assert.ok(id && saved); assert.equal(saved.kind, 'extracted');
    assert.notEqual(saved.subjectPath, saved.originalPath);
    const imageBytes = Buffer.from(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), saved.subjectPath), 'base64');
    fs.writeFileSync(path.join(output, 'actual-cutout.png'), imageBytes);
    const image = await loadImage(imageBytes), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let transparent = 0, opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) { if (pixels[i] === 0) transparent++; if (pixels[i] === 255) opaque++; }
    assert.ok(transparent > 0 && opaque > 0, 'Actual saved result must contain both transparent and foreground pixels');
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
    await continueButton.tap(); await wait(card, data => !data.task && !data.sourceStage);
    await card.callMethod('cancelPhoto');
    assert.equal(Object.keys((await readState()).memories).length, 1);
    checks.push('real upload/extraction/download produces a transparent saved PNG; original/result comparison preserves the saved file; done persists until continue; same home and one commit');
    await capture('05-arrange');
    console.log('STEP: continued to arrangement on the same home page');
    await (await card.$('#close-record')).tap(); await wait(home, data => !data.editorOpen && data.count === 1);
    await (await home.$('#record-today')).tap(); await wait(home, data => data.editorOpen);
    card = await home.$('#record-card'); await wait(card, data => !data.loading);
    assert.equal((await card.data()).task, null);
    await (await card.$('#record-album')).tap(); await wait(card, data => data.task && data.task.state === 'preview');
    await card.callMethod('retryPhoto');
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
  fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ passed: true, at: new Date().toISOString(), storageRestored: restored, states, checks, screenshots, limitations: ['System photo picker uses a test fixture', 'Loopback test endpoint; public HTTPS and physical phone not verified', 'Animation screenshots are samples, not frame-accurate comparison with the original APK'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
