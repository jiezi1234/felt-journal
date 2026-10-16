/* Native Canvas peel/placement acceptance with an already-saved test sticker.
 * Run alone. Storage is backed up on disk and restored in finally. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadImage } = require('@napi-rs/canvas');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1'];
const output = path.resolve(process.env.WECHAT_STICKER_OUTPUT || 'artifacts/sticker-ui');
(async () => {
  const fixture = process.env.WECHAT_TEST_STICKER;
  assert.ok(fixture && fs.existsSync(fixture), 'Set WECHAT_TEST_STICKER');
  fs.mkdirSync(output, { recursive: true }); fs.mkdirSync('artifacts', { recursive: true });
  let mini, backup, file, restored = false; const frames = [], errors = [];
  try {
    mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9420' }); mini.on('exception', e => errors.push(e));
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    fs.writeFileSync('artifacts/sticker-storage-backup.json', JSON.stringify(backup));
    const bytes = fs.readFileSync(fixture), image = await loadImage(bytes);
    file = await mini.evaluate(bytes => { const p = `${wx.env.USER_DATA_PATH}/felt-sticker-acceptance.png`; wx.getFileSystemManager().writeFileSync(p, bytes, 'base64'); wx.getFileSystemManager().writeFileSync(p + '.original.png', bytes, 'base64'); return p; }, bytes.toString('base64'));
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const id = store.add('sticker-test', dates.key(), { originalPath: file + '.original.png', subjectPath: file, width: image.width, height: image.height, kind: 'extracted' });
    store.commit(s => { s.localNoticeSeen = true; });
    await mini.evaluate((names, data) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], data); }, keys, JSON.stringify(store.get()));
    const home = await mini.reLaunch('/pages/index/index'); await pause(900);
    await (await home.$('#record-today')).tap(); await pause(500);
    await mini.evaluate((id, file) => {
      const card = getCurrentPages().at(-1).selectComponent('#record-card');
      card.photoDone(id); card.photoTask = { committed: true };
      card.setData({ task: { state: 'done', committed: true, kind: 'extracted', original: file, subject: file } });
    }, id, file);
    await pause(1100);
    const card = await home.$('#record-card'), panel = await card.$('#record-photo');
    await mini.screenshot({ path: path.join(output, 'native-ready.png') });
    await (await panel.$('#continue-layout')).tap();
    const start = Date.now(); let capturedPeel = false, capturedFlight = false, started = false;
    while (Date.now() - start < 6800) {
      const snapshot = await mini.evaluate(() => {
        const c = getCurrentPages().at(-1).selectComponent('#record-card'), b = c.selectComponent('#board'), f = c.selectComponent('#placement-flight');
        return { placing: c.data.placing, task: !!c.data.task, phase: f && f.data.phase, painted: f && f.data.painted, flightExists: !!f, flightType: f && f.is, drawType: f && typeof f.draw,
          compositedMesh: !!(f && f.shadowLayer), legacyRenderer: !!(f && f.shadow), canvasOrigin: f && f.origin,
          board: b && { landingId: b.data.landingId, snapshot: !!b.data.snapshot, width: b.screenWidth, canvas: !!b.canvas, height: b.data.height } };
      });
      frames.push({ ms: Date.now() - start, ...snapshot });
      if (snapshot.placing) started = true;
      if (!capturedPeel && snapshot.phase === 'peeling' && snapshot.painted) { await mini.screenshot({ path: path.join(output, 'native-peeling.png') }); capturedPeel = true; }
      if (!capturedFlight && snapshot.phase === 'flying') { await mini.screenshot({ path: path.join(output, 'native-flying.png') }); capturedFlight = true; }
      if (started && !snapshot.placing) break;
      await pause(90);
    }
    await mini.screenshot({ path: path.join(output, 'native-landed.png') });
    fs.writeFileSync(path.join(output, 'native-frames.json'), JSON.stringify({ frames, errors }, null, 2));
    assert.ok(capturedPeel, 'Canvas rendered the source peel'); assert.ok(capturedFlight, 'Canvas reached the measured board target');
    assert.ok(frames.some(frame => frame.compositedMesh), 'DevTools loaded the current renderer');
    assert.equal(frames.at(-1).placing, null); assert.equal((await card.data()).count, 1);
    const saved = JSON.parse(await mini.callWxMethod('getStorageSync', keys[0])); assert.equal(Object.keys(saved.memories).length, 1);
    assert.equal(errors.length, 0, JSON.stringify(errors));
    console.log('PASS: native peel -> measured flight -> landing, no duplicate memory');
  } finally {
    if (mini) {
      if (backup) {
        await mini.evaluate(() => { const p = getCurrentPages().at(-1); if (p && p.data.editorOpen) p.setData({ editorOpen: false }); }); await pause(200);
        await mini.evaluate(items => items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)), backup);
        assert.deepEqual(await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys), backup); restored = true;
      }
      if (file) await mini.evaluate(file => { for (const p of [file, file + '.original.png']) { try { wx.getFileSystemManager().unlinkSync(p); } catch (_) {} } }, file);
      await mini.reLaunch('/pages/index/index').catch(() => {}); mini.disconnect();
      fs.writeFileSync(path.join(output, 'native-cleanup.json'), JSON.stringify({ storageRestored: restored }, null, 2));
    }
  }
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
