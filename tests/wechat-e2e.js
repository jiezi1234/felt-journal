/* Native WeChat simulator E2E. Temporarily isolates and finally restores journal storage.
 * Native photo picker is mocked with a generated file; app file persistence, page
 * rendering, editing, reload and Canvas export all execute in WeChat's runtime.
 * Physical camera, real album permission/write and remote inference need a phone.
 */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { paint } = require('../miniprogram/core/renderer');
const root = path.resolve(__dirname, '..');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const output = path.join(root, 'artifacts');
const realService = process.env.WECHAT_EXTRACTION_ENDPOINT || '';
(async () => {
  let mini, backup, testPhoto, pickerMocked = false, modalMocked = false; const errors = [], checks = [];
  async function wait(page, predicate, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) { const data = await page.data(); if (predicate(data)) return data; await new Promise(r => setTimeout(r, 150)); }
    throw new Error(`Timed out on ${page.path}: ${JSON.stringify(await page.data())}`);
  }
  async function route(expected) {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      try { const page = await mini.currentPage(); if (page && page.path === expected) return page; }
      catch (error) { if (!/getPageMetaByWebviewId|rawPath/.test(error.message)) throw error; }
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error(`Navigation did not reach ${expected}`);
  }
  async function capture(name) {
    // DevTools capture of native Canvas may intermittently time out. Keep that
    // optional visual task separate from acceptance of actual app behavior.
    if (process.env.WECHAT_SCREENSHOTS !== '1') return;
    try { await mini.screenshot({ path: path.join(output, name) }); }
    catch (error) { console.warn(`Screenshot skipped (${name}): ${error.message}`); }
  }
  try {
    for (let attempt = 0; attempt < 15; attempt++) {
      try { mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' }); break; }
      catch (error) { if (attempt === 14) throw error; await new Promise(r => setTimeout(r, 1000)); }
    }
    await new Promise(r => setTimeout(r, 5000));
    mini.on('exception', e => errors.push(e)); fs.mkdirSync(output, { recursive: true });
    backup = await mini.evaluate(keys => keys.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    await mini.evaluate(keys => {
      keys.forEach(key => wx.removeStorageSync(key));
      wx.setStorageSync(keys[0], JSON.stringify({ version: 1, revision: 0, boards: {}, memories: {}, operations: {}, garbage: [], localNoticeSeen: true }));
    }, keys);
    if (realService) await mini.evaluate((key, endpoint) => wx.setStorageSync(key, endpoint), keys[3], realService);
    console.log('STEP: isolated storage initialized');
    const fixture = createCanvas(400, 300), context = fixture.getContext('2d');
    context.fillStyle = '#D9CBAF'; context.fillRect(0, 0, 400, 300); context.fillStyle = '#396848'; context.beginPath(); context.arc(200, 150, 90, 0, Math.PI * 2); context.fill();
    context.clearRect(250, 10, 120, 60); // asymmetric alpha patch validates native crop/rotation/mirror output
    const photoBytes = realService ? fs.readFileSync(process.env.WECHAT_TEST_PHOTO || path.join(output, 'rembg-animal-1.jpg')) : fixture.toBuffer('image/png');
    testPhoto = await mini.evaluate(base64 => { const file = `${wx.env.USER_DATA_PATH}/felt-e2e-fixture.png`; wx.getFileSystemManager().writeFileSync(file, base64, 'base64'); return file; }, photoBytes.toString('base64'));
    await mini.mockWxMethod('chooseMedia', { tempFiles: [{ tempFilePath: testPhoto, size: 3000, fileType: 'image' }], type: 'image' });
    pickerMocked = true;
    console.log('STEP: local photo picker fixture installed');
    await mini.callWxMethod('reLaunch', { url: '/pages/index/index' });
    let home = await route('pages/index/index'); await wait(home, d => !d.loading); assert.equal((await home.data()).count, 0); assert.equal((await home.data()).error, '');
    console.log('STEP: empty home loaded');
    const date = (await home.data()).date;
    await capture('wechat-home-empty.png');
    let board = await mini.navigateTo(`/pages/board/index?date=${date}&mode=edit`); await wait(board, d => !d.loading);
    console.log('STEP: native board opened');
    const uploadStartedAt = Date.now();
    await board.callMethod('album');
    if (!realService) {
      await wait(board, d => d.task && d.task.state === 'extractError');
      assert.equal((await board.data()).count, 0); await board.callMethod('originalPhoto');
    }
    await wait(board, d => d.count === 0 && d.task && d.task.state === 'done', realService ? 90000 : 15000);
    await board.callMethod('continuePhoto'); await wait(board, d => !d.task && d.count === 1);
    let data = await board.data(), id = data.selected;
    assert.ok(id); assert.equal(data.editable, true); assert.equal(data.model.items[0].memory.kind, realService ? 'extracted' : 'original');
    assert.notEqual(data.model.items[0].memory.originalPath, data.model.items[0].memory.subjectPath);
    if (realService) {
      const subject = data.model.items[0].memory.subjectPath;
      const bytes = await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), subject);
      fs.writeFileSync(path.join(output, 'wechat-real-subject.png'), Buffer.from(bytes, 'base64'));
      checks.push(`real wx.uploadFile -> CPU ML -> wx.downloadFile -> saved/selected (${Date.now() - uploadStartedAt} ms)`);
    } else checks.push('photo fallback -> persistent original/subject -> atomic memory/placement -> selected');
    console.log('STEP: add committed, checking drag controls');
    const component = await board.$('#board'); await board.waitFor(500); assert.ok(component, 'Board component must render');
    const grips = await component.$$('.grip'); assert.equal(grips.length, 3);
    assert.equal(parseFloat(await grips[0].style('width')), 44, 'Native button defaults must not enlarge corner grips');
    const dragControl = require('./helpers/drag-control');
    const angle = data.model.items[0].angle; await dragControl(mini, component, '#board', 'rotate', 27.5); data = await wait(board, d => Math.abs(d.model.items[0].angle - (angle + 27.5) % 360) < .01);
    const width = data.model.items[0].width; await dragControl(mini, component, '#board', 'resize', 1.2); data = await wait(board, d => d.model.items[0].width > width); assert.ok(data.model.items[0].width > width);
    await board.callMethod('color', { currentTarget: { dataset: { value: '#C3D0BD' } } });
    await wait(board, d => d.model.color === '#C3D0BD');
    for (const selector of ['#undo-layout', '#redo-layout']) assert.equal(await board.$(selector), null);
    console.log('STEP: color saved, adding overlapping second item');
    await board.callMethod('album');
    if (!realService) { await wait(board, d => d.task && d.task.state === 'extractError'); await board.callMethod('originalPhoto'); }
    await wait(board, d => d.count === 1 && d.task && d.task.state === 'done', realService ? 90000 : 15000);
    await board.callMethod('continuePhoto'); await wait(board, d => !d.task && d.count === 2);
    data = await board.data(); const secondId = data.selected;
    assert.notEqual(secondId, id); assert.equal(data.canUndo, false, 'Adding starts a new layout history');
    const firstGeometry = data.model.placements.find(p => p.memoryId === id);
    await board.callMethod('select', { detail: { id } });
    assert.equal((await board.data()).canSendToBack, false);
    await (await board.$('#layer-front')).tap();
    await wait(board, d => d.model.items[d.model.items.length - 1].memoryId === id);
    await (await board.$('#layer-back')).tap(); await wait(board, d => d.model.items[0].memoryId === id);
    const frontGeometry = (await board.data()).model.placements.find(p => p.memoryId === id);
    assert.deepEqual({ ...frontGeometry, z: 0 }, { ...firstGeometry, z: 0 });
    assert.equal((await board.data()).canBringToFront, true);
    checks.push('native front/back buttons; undo/redo buttons absent; addition resets history; layer changes preserve geometry');
    await board.callMethod('select', { detail: { id: '' } });
    assert.equal(await board.$('#open-appearance'), null, 'Board decoration is configured only when sharing');
    await capture('wechat-board-edit.png');
    const savedPlacements = (await board.data()).model.placements;
    console.log('STEP: transforms saved, checking card and then legacy photo-edit data compatibility');
    await board.callMethod('done'); await board.callMethod('memory', { detail: { id } });
    assert.equal(await (await board.$('#memory-card')).$('#memory-options'), null);
    await board.callMethod('closeMemoryCard');
    // Legacy image editing remains covered directly; it has no card UI entry.
    await mini.evaluate(url => new Promise((resolve, reject) => wx.navigateTo({ url, success: () => resolve(true), fail: e => reject(new Error(e.errMsg)) })), `/pages/memory/index?id=${encodeURIComponent(id)}`);
    await board.waitFor(800);
    let memory = await route('pages/memory/index'); await wait(memory, d => !d.loading);
    await memory.callMethod('edit'); await memory.callMethod('textInput', { detail: { value: '模拟器端到端验收文字' } }); await memory.callMethod('categoryInput', { detail: { value: '1' } }); await memory.callMethod('save');
    assert.equal((await memory.data()).memory.text, '模拟器端到端验收文字');
    await memory.callMethod('section', { currentTarget: { dataset: { section: 'subject' } } });
    const beforeCrop = (await memory.data()).memory;
    const originalBytes = await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), beforeCrop.originalPath);
    const originalInfo = await mini.callWxMethod('getImageInfo', { src: beforeCrop.originalPath });
    await (await memory.$('#adjust-image')).tap(); let crop = await route('pages/photo-edit/index');
    let cropData = await wait(crop, d => d.ready && !d.loading); assert.equal(cropData.error, ''); assert.equal(cropData.dirty, false);
    const initialDimensions = cropData.dimensions;
    await (await crop.$('#ratio-1')).tap(); await wait(crop, d => d.ratio === 1);
    await (await crop.$('#rotate-image')).tap(); await (await crop.$('#mirror-image')).tap();
    await (await crop.$('#reset-image')).tap(); await wait(crop, d => !d.dirty); assert.equal((await crop.data()).dimensions, initialDimensions);
    const handle = (await crop.$$('.crop-handle'))[3], corner = await handle.offset();
    const finger = { identifier: 0, clientX: corner.left + 22, clientY: corner.top + 22 };
    await handle.touchstart({ touches: [finger] }); await crop.waitFor(200);
    await handle.touchmove({ touches: [{ ...finger, clientX: finger.clientX - 24, clientY: finger.clientY - 18 }] }); await handle.touchend({ touches: [] });
    await wait(crop, d => d.dirty); assert.notEqual((await crop.data()).dimensions, initialDimensions, 'Native corner drag changes crop');
    await (await crop.$('#ratio-1')).tap(); await (await crop.$('#rotate-image')).tap(); await (await crop.$('#mirror-image')).tap();
    cropData = await crop.data(); const cropSize = cropData.dimensions.split(' × ').map(Number); assert.equal(cropSize[0], cropSize[1]);
    if (process.env.WECHAT_CROP_SCREENSHOT === '1') { try { await mini.screenshot({ path: path.join(output, 'wechat-photo-edit.png') }); } catch (error) { console.warn(`Crop screenshot skipped: ${error.message}`); } }
    console.log('STEP: crop drag, presets and image transforms checked; saving native PNG');
    await (await crop.$('#save-image')).tap(); memory = await route('pages/memory/index');
    const afterCrop = (await wait(memory, d => d.memory && d.memory.subjectEdited)).memory;
    assert.equal(afterCrop.originalPath, beforeCrop.originalPath); assert.notEqual(afterCrop.subjectPath, beforeCrop.subjectPath);
    assert.deepEqual([afterCrop.width, afterCrop.height], cropSize); assert.equal(afterCrop.text, beforeCrop.text); assert.equal(afterCrop.category, beforeCrop.category);
    assert.equal(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), afterCrop.originalPath), originalBytes);
    const cropInfo = await mini.callWxMethod('getImageInfo', { src: afterCrop.subjectPath }); assert.deepEqual([cropInfo.width, cropInfo.height], cropSize);
    const croppedBytes = Buffer.from(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), afterCrop.subjectPath), 'base64');
    fs.writeFileSync(path.join(output, 'wechat-cropped-subject.png'), croppedBytes);
    if (!realService) {
      const croppedImage = await loadImage(croppedBytes), actual = createCanvas(300, 300), pixels = actual.getContext('2d'); pixels.drawImage(croppedImage, 0, 0);
      assert.equal(pixels.getImageData(30, 250, 1, 1).data[3], 0, 'Native PNG preserves the transformed alpha patch');
      assert.deepEqual(Array.from(pixels.getImageData(150, 150, 1, 1).data), [57, 104, 72, 255]);
    }
    await (await memory.$('#adjust-image')).tap(); crop = await route('pages/photo-edit/index'); await wait(crop, d => d.ready && !d.loading);
    await (await crop.$('#source-original')).tap(); await wait(crop, d => d.ready && !d.loading && d.source === 'original'); assert.equal((await crop.data()).dimensions, `${originalInfo.width} × ${originalInfo.height}`);
    await mini.mockWxMethod('showModal', { confirm: true, cancel: false }); modalMocked = true;
    await crop.callMethod('back'); memory = await route('pages/memory/index'); await mini.restoreWxMethod('showModal'); modalMocked = false;
    assert.equal((await memory.data()).memory.subjectPath, afterCrop.subjectPath, 'Discarding original-source edit preserves saved crop');
    checks.push('native crop corner gesture, square preset, rotation/mirror/reset, PNG save, original bytes preserved and discard without changes');
    await mini.navigateBack(); board = await route('pages/board/index');
    await wait(board, d => d.model && d.model.items.find(p => p.memoryId === id).memory.category === '饮食');
    assert.equal((await board.data()).model.items.find(p => p.memoryId === id).memory.subjectPath, afterCrop.subjectPath);
    assert.deepEqual((await board.data()).model.placements, savedPlacements);
    checks.push('native size/angle drag controls, color save, detail text/category and return; crop preserves full layout');
    console.log('STEP: detail saved, testing relaunch');
    await mini.callWxMethod('reLaunch', { url: '/pages/index/index' }); home = await route('pages/index/index'); await wait(home, d => !d.loading && !!d.model);
    assert.equal((await home.data()).count, 2); assert.equal((await home.data()).model.color, '#C3D0BD'); assert.equal((await home.data()).model.texture, 'fine'); assert.deepEqual((await home.data()).model.placements, savedPlacements);
    assert.equal((await home.data()).model.items[(await home.data()).model.items.length - 1].memoryId, id);
    assert.equal((await home.data()).model.items.find(p => p.memoryId === id).memory.subjectPath, afterCrop.subjectPath);
    await capture('wechat-home-saved.png'); checks.push('relaunch reloads same image, placement and color');
    board = await mini.navigateTo(`/pages/board/index?date=${date}`); await wait(board, d => !d.loading);
    console.log('STEP: restored layout, generating native canvas export');
    const beforeShare = await mini.callWxMethod('getStorageSync', keys[0]);
    await board.callMethod('exportBoard'); const exported = await board.$('#share-card'); await wait(exported, d => !d.generating);
    await exported.callMethod('openAppearance'); await (await exported.$('#share-color-4')).tap(); await wait(exported, d => !d.generating && d.previewColor === '#C4D2D6');
    await (await exported.$('#share-texture-cross')).tap(); const generated = await wait(exported, d => !d.generating && d.previewTexture === 'cross');
    assert.equal(await mini.callWxMethod('getStorageSync', keys[0]), beforeShare);
    assert.equal(generated.error, ''); assert.ok(generated.imagePath);
    const info = await mini.callWxMethod('getImageInfo', { src: generated.imagePath }); assert.equal(info.width, 1800); assert.equal(info.height, 1546); assert.equal(generated.albumSaved, false);
    const exportedBytes = Buffer.from(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), generated.imagePath), 'base64');
    fs.writeFileSync(path.join(output, 'wechat-textured-export.png'), exportedBytes);
    const nativeOutput = createCanvas(1800, 1546), nativeCtx = nativeOutput.getContext('2d'); nativeCtx.drawImage(await loadImage(exportedBytes), 0, 0);
    // Keep the texture sample on felt as the transparent top margin grows.
    const patchY = Math.round(288*1546/1288) + 150;
    const actualPatch = nativeCtx.getImageData(200, patchY, 300, 250).data;
    function materialError(texture) {
      const expected = createCanvas(1800, 1546), ctx = expected.getContext('2d'); ctx.setTransform(1.2,0,0,1546/1288,0,288*1546/1288); paint(ctx, { color: '#C4D2D6', texture, items: [] }, {}, '');
      const expectedPatch = ctx.getImageData(200, patchY, 300, 250).data; let total = 0;
      actualPatch.forEach((value, index) => { total += Math.abs(value - expectedPatch[index]); }); return total / actualPatch.length;
    }
    const selectedError = materialError('cross'), defaultError = materialError('fine');
    assert.ok(selectedError < defaultError && selectedError < 2, `Export must contain selected texture: selected=${selectedError}, default=${defaultError}`);
    checks.push('share-only color/texture leaves stored boards unchanged; real exported pixels match selected material');
    await capture('wechat-export.png'); checks.push('real WeChat Canvas 1800x1546 export including clamp with generated/album states separated');
    console.log('STEP: export generated, checking calendar');
    await mini.callWxMethod('reLaunch', { url: '/pages/calendar/index' }); let calendar = await route('pages/calendar/index'); await wait(calendar, d => !d.loading && !!d.cells);
    let cal = await calendar.data(); assert.equal(cal.cells.find(c => c.date === date).images.length, 2); assert.equal(cal.cells.length % 7, 0);
    assert.equal(cal.cells.find(c => c.date === date).images.find(image => image.id === id).path, afterCrop.subjectPath);
    assert.deepEqual(cal.cells.find(c => c.date === date).images.map(image => image.id), [id, secondId], 'Layer changes must not reorder calendar previews');
    await calendar.callMethod('previous'); const historical = await calendar.data(); const past = `${historical.year}-${String(historical.month).padStart(2, '0')}-01`;
    const before = await mini.callWxMethod('getStorageSync', keys[0]); await calendar.callMethod('open', { currentTarget: { dataset: { date: past } } }); await wait(calendar, d => d.boardDate === past); board = await calendar.$('#day-board-card'); await wait(board, d => !d.loading);
    assert.equal((await board.data()).canEdit, false); assert.equal(await mini.callWxMethod('getStorageSync', keys[0]), before);
    await board.callMethod('close'); await wait(calendar, d => !d.boardDate); assert.equal((await calendar.data()).month, historical.month);
    await capture('wechat-calendar.png'); checks.push('month return, real preview, historical empty read has no mutation');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    fs.writeFileSync(path.join(output, realService ? 'wechat-real-extraction-e2e.json' : 'wechat-e2e.json'), JSON.stringify({ passed: true, recordedAt: new Date().toISOString(), realService: !!realService, checks, limitations: ['Picker mocked with a local fixture', 'Device checks are recorded separately in device-acceptance.json', 'Public HTTPS deployment pending'] }, null, 2));
    console.log('PASS:', checks.join('\nPASS: '));
  } catch (error) { console.error('E2E failure before cleanup:', error.stack || error); throw error; } finally {
    if (mini) {
      if (pickerMocked) await mini.restoreWxMethod('chooseMedia').catch(() => {});
      if (modalMocked) await mini.restoreWxMethod('showModal').catch(() => {});
      if (backup) {
        // Clean up only test-owned files while the isolated test snapshot exists.
        await mini.evaluate(key => {
          const raw = wx.getStorageSync(key); if (!raw) return;
          const state = JSON.parse(raw), referenced = Object.values(state.memories).flatMap(m => [m.originalPath, m.subjectPath]).concat(state.garbage || []);
          for (const file of referenced) if (file.startsWith(`${wx.env.USER_DATA_PATH}/felt-journal/`)) { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }
        }, keys[0]);
        await mini.evaluate(items => items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)), backup);
      }
      if (testPhoto) await mini.evaluate(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }, testPhoto);
      await mini.evaluate(() => { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({}); }).catch(() => {});
      await mini.reLaunch('/pages/index/index').catch(() => {}); mini.disconnect();
    }
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
