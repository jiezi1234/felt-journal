/* Native card/drawer acceptance. Isolated storage is restored byte-for-byte.
 * Do not edit or compile the mini-program while this test is running.
 * The system picker uses local fixtures; remote extraction is not exercised. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1'];
const output = path.resolve(__dirname, '../artifacts/ui-record-card-2026-10-16');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms || 150));
(async () => {
  let mini, backup, picker, testFiles = [], storageRestored = false, isolated = false, pickerMocked = false, modalMocked = false;
  const checks = [], screenshots = [], errors = [];
  async function wait(target, predicate) {
    const start = Date.now();
    while (Date.now() - start < 15000) { const data = await target.data(); if (predicate(data)) return data; await pause(); }
    throw new Error(`Timed out: ${JSON.stringify(await target.data())}`);
  }
  async function state() { return JSON.parse(await mini.callWxMethod('getStorageSync', keys[0])); }
  async function route(name) { const start = Date.now(); while (Date.now() - start < 15000) { const page = await mini.currentPage(); if (page.path === `pages/${name}/index`) return page; await pause(); } throw new Error(`Did not reach ${name}`); }
  async function capture(name) {
    if (process.env.WECHAT_SCREENSHOTS !== '1') return;
    await mini.callWxMethod('hideToast', {}); await pause(600);
    await mini.screenshot({ path: path.join(output, `${name}.png`) }); screenshots.push(name);
  }
  async function assertHome(home, id) { assert.equal((await mini.currentPage()).id, id); assert.equal((await mini.pageStack()).length, 1); assert.equal(home.path, 'pages/index/index'); }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    await pause(1500);
    mini.on('exception', error => errors.push(error)); fs.mkdirSync(output, { recursive: true });
    backup = await mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
    const canvas = createCanvas(240, 240), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#79956E'; ctx.beginPath(); ctx.ellipse(120, 120, 55, 90, .35, 0, 2 * Math.PI); ctx.fill();
    const fallback = canvas.toBuffer('image/png');
    const samples = ['food', 'plants', 'animal'];
    for (const name of samples) {
      const local = path.resolve(__dirname, `../artifacts/rembg-${name}-1-cutout.png`);
      const bytes = process.env.WECHAT_SCREENSHOTS === '1' && fs.existsSync(local) ? fs.readFileSync(local) : fallback;
      const files = await mini.evaluate((bytes, name) => ['original', 'subject'].map(kind => { const file = `${wx.env.USER_DATA_PATH}/felt-record-test-${name}-${kind}.png`; wx.getFileSystemManager().writeFileSync(file, bytes, 'base64'); return file; }), bytes.toString('base64'), `${Date.now()}-${name}`);
      testFiles.push(...files);
    }
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const today = dates.key(), old = '2020-01-01';
    const info = await mini.callWxMethod('getImageInfo', { src: testFiles[0] });
    const photos = index => ({ originalPath: testFiles[index * 2], subjectPath: testFiles[index * 2 + 1], width: info.width, height: info.height, kind: 'extracted' });
    const first = store.add('card_first', today, photos(0)), second = store.add('card_second', today, photos(1)), past = store.add('card_past', old, photos(2));
    store.edit(first, '今天也有好好吃饭', '饮食'); store.edit(second, '窗边的小小绿意', '自然');
    store.createTheme('food', '好好吃饭', first); store.createTheme('life', '生活里的小可爱', past); store.place(second, 'theme_life');
    store.commit(s => { s.localNoticeSeen = true; });
    const originalTheme = store.board('theme_food');
    await mini.evaluate((names, snapshot) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], snapshot); }, keys, JSON.stringify(store.get())); isolated = true;
    picker = await mini.evaluate(() => typeof wx.chooseMedia === 'function' ? 'chooseMedia' : 'chooseImage');
    await mini.mockWxMethod(picker, { tempFiles: [{ tempFilePath: testFiles[0], path: testFiles[0], size: 3000, fileType: 'image' }], tempFilePaths: [testFiles[0]], type: 'image' });
    pickerMocked = true;
    let home = await mini.reLaunch('/pages/index/index'); await wait(home, d => !d.loading); const homeId = home.id;
    await capture('01-today');
    await mini.callWxMethod('pageScrollTo', { scrollTop: 120, duration: 0 }); await pause(250); const scroll = await home.scrollTop();
    const initial = await mini.callWxMethod('getStorageSync', keys[0]);
    await (await home.$('#record-today')).tap(); await wait(home, d => d.editorOpen);
    let card = await home.$('#record-card'); await wait(card, d => !d.loading && d.sourceStage);
    await assertHome(home, homeId);
    await wait(await home.$('#today-board'), d => d.covered && d.snapshot);
    assert.equal(await mini.evaluate(() => getCurrentPages()[0].getTabBar().data.hidden), true);
    await pause(400); // Inspect resting geometry after the 320 ms entry transition.
    const rect = await mini.evaluate(() => new Promise(resolve => getCurrentPages()[0].selectComponent('#record-card').createSelectorQuery().select('.record-card').boundingClientRect(resolve).exec()));
    const device = await mini.systemInfo(); assert.ok(rect.top > 80 && rect.bottom <= device.windowHeight + 1, 'Underlying home must remain visible above the card');
    await capture('02-record-card');
    await (await card.$('#close-record')).tap(); await wait(home, d => !d.editorOpen); await assertHome(home, homeId);
    assert.ok(Math.abs(await home.scrollTop() - scroll) <= 1); assert.equal(await mini.callWxMethod('getStorageSync', keys[0]), initial);
    checks.push('record opens an overlay on the same page; underlying home visible; close preserves scroll and storage; bottom navigation hidden while editing');
    console.log('STEP: card open/close, page identity and scroll passed');
    await (await home.$('#record-today')).tap(); await wait(home, d => d.editorOpen); card = await home.$('#record-card'); await wait(card, d => !d.loading);
    await (await card.$('#record-album')).tap(); await wait(card, d => d.task && d.task.state === 'extractError');
    await assertHome(home, homeId); assert.equal((await card.data()).count, 2);
    const panel = await card.$('#record-photo'); assert.ok(panel, 'Inline photo panel must render'); assert.equal((await panel.data()).inline, true);
    await (await panel.$('.secondary')).tap(); await wait(card, d => d.task && d.task.state === 'done' && d.count === 3);
    const added = (await card.data()).selected;
    console.log('STEP: photo result ready, adding optional caption');
    await (await panel.$('#add-photo-note')).tap(); await wait(card, d => d.photoNoteOpen);
    await panel.callMethod('noteInput', { detail: { value: '记录时留下的说明\n今天的小小美好' } });
    await (await panel.$('#continue-layout')).tap();
    let data = await wait(home, d => !d.editorOpen && !d.placing && d.count === 3 && d.editable);
    await assertHome(home, homeId); assert.ok(added); assert.equal(data.model.items.find(m => m.memoryId === added).memory.kind, 'original');
    assert.equal((await state()).memories[added].text, '记录时留下的说明\n今天的小小美好');
    console.log('STEP: caption persisted, opening sticker card');
    // Dispatch the board's real touch-end handler, including the select -> memory event chain.
    await mini.evaluate(id => { const b = getCurrentPages()[0].selectComponent('#today-board'); b.gesture = { item: b.data.model.items.find(item => item.memoryId === id) }; b.touchEnd(); }, added);
    await wait(home, d => d.memoryCardId === added); await assertHome(home, homeId); console.log('STEP: memory overlay mounted');
    let memoryCard = await home.$('#memory-card'); await wait(memoryCard, d => !!d.memory);
    assert.equal((await memoryCard.data()).flipped, false);
    assert.equal(await mini.evaluate(() => getCurrentPages()[0].getTabBar().data.hidden), true);
    await (await memoryCard.$('#flip-card')).tap(); await wait(memoryCard, d => d.flipped); await pause(500); console.log('STEP: memory card flipped');
    assert.ok(await memoryCard.$('.card-note')); assert.equal((await memoryCard.data()).memory.text, '记录时留下的说明\n今天的小小美好');
    const transform = await (await memoryCard.$('#flip-card')).style('transform');
    const geometry = await mini.evaluate(() => new Promise(resolve => {
      const q = getCurrentPages()[0].selectComponent('#memory-card').createSelectorQuery();
      q.select('#edit-card-note').boundingClientRect();
      q.exec(rects => resolve({ button: rects[0], height: wx.getWindowInfo().windowHeight }));
    }));
    assert.match(transform, /matrix3d\(-1/); assert.ok(geometry.button.top > 0 && geometry.button.bottom < geometry.height); console.log('STEP: flip transform and back controls verified');
    await (await memoryCard.$('#edit-card-note')).tap(); await wait(memoryCard, d => d.editing);
    await memoryCard.callMethod('input', { detail: { value: '后来补充的新说明' } }); await (await memoryCard.$('#save-card-note')).tap();
    await wait(memoryCard, d => !d.editing && d.memory.text === '后来补充的新说明');
    await (await memoryCard.$('#close-memory-card')).tap(); await wait(home, d => !d.memoryCardId);
    assert.equal((await state()).memories[added].text, '后来补充的新说明');
    await home.callMethod('openMemory', { detail: { id: added } }); memoryCard = await home.$('#memory-card');
    await wait(memoryCard, d => d.memory && d.memory.text === '后来补充的新说明');
    await (await memoryCard.$('#flip-card')).tap(); await wait(memoryCard, d => d.flipped);
    await (await memoryCard.$('#close-memory-card')).tap(); await wait(home, d => !d.memoryCardId);
    checks.push('optional upload caption -> same-page sticker card -> native 3D flip -> edit/save -> reopen with persisted text; navigation hidden behind card');
    assert.equal(await home.$('#record-card'), null); assert.equal(await home.$('#open-appearance'), null);
    await capture('03-arrange-today');
    const originalAngle = data.model.items.find(m => m.memoryId === added).angle;
    await home.callMethod('transform', { detail: { op: 'cw' } });
    await wait(home, d => d.model.items.find(m => m.memoryId === added).angle !== originalAngle);
    await (await home.$('#undo-today')).tap(); await wait(home, d => d.model.items.find(m => m.memoryId === added).angle === originalAngle);
    await (await home.$('#redo-today')).tap(); await wait(home, d => d.model.items.find(m => m.memoryId === added).angle !== originalAngle);
    assert.deepEqual((await state()).boards.theme_food, originalTheme);
    await (await home.$('#more-today')).tap(); await wait(home, d => d.drawer === 'selection');
    await wait(await home.$('#today-board'), d => d.covered && d.snapshot);
    assert.ok(await home.$('#edit-memory')); assert.ok(await home.$('#remove-placement'));
    await capture('04-sticker-actions');
    await (await home.$('#close-drawer')).tap(); await wait(home, d => !d.drawer);
    await assertHome(home, homeId);
    await (await home.$('#finish-today')).tap(); await wait(home, d => !d.editable && d.count === 3);
    assert.equal(await mini.evaluate(() => getCurrentPages()[0].getTabBar().data.hidden), false);
    checks.push('automatic photo processing -> fallback -> animated placement on Today -> undo/redo -> sticker actions -> finish on home; theme unchanged');
    console.log('STEP: photo card and direct Today arrangement passed');
    await (await home.$('#record-today')).tap(); await wait(home, d => d.editorOpen); card = await home.$('#record-card'); await wait(card, d => !d.loading);
    await (await card.$('#record-album')).tap(); await wait(card, d => d.task && d.task.state === 'extractError');
    await mini.mockWxMethod('showModal', { confirm: false, cancel: true }); modalMocked = true; await (await card.$('#close-record')).tap(); assert.equal((await home.data()).editorOpen, true);
    await mini.mockWxMethod('showModal', { confirm: true, cancel: false }); await (await card.$('#close-record')).tap(); await wait(home, d => !d.editorOpen);
    await pause(500); assert.equal((await home.data()).count, 3); assert.equal(Object.keys((await state()).memories).length, 4);
    checks.push('declining close retains the photo task; confirming cancels without creating a memory or changing the page');
    const beforeShare = await mini.callWxMethod('getStorageSync', keys[0]);
    await (await home.$('#export-today')).tap(); const exportPage = await route('export'); await wait(exportPage, d => !d.generating && !!d.imagePath);
    assert.equal((await exportPage.$$('.share-color')).length, 6);
    await (await exportPage.$('#share-color-5')).tap(); await wait(exportPage, d => !d.generating && d.previewColor === '#E6DABB');
    await (await exportPage.$('#share-texture-long')).tap(); await wait(exportPage, d => !d.generating && d.previewTexture === 'long');
    assert.equal(await mini.callWxMethod('getStorageSync', keys[0]), beforeShare);
    await capture('05-share-appearance'); checks.push('Share has 6 colors and 3 textures; choices do not change stored Today or theme boards');
    await mini.navigateBack(); home = await route('index'); await assertHome(home, homeId);
    await home.callMethod('openMemory', { detail: { id: first } }); await wait(home, d => d.memoryCardId === first);
    await home.callMethod('memoryOptions', { detail: { id: first } }); await route('memory'); await mini.navigateBack(); await route('index');
    await mini.evaluate(() => getCurrentPages().slice(-1)[0].getTabBar().selectComponent('#main-nav').open({ currentTarget: { dataset: { id: 'board' } } }));
    const themes = await route('board-tab'); await wait(themes, d => !d.loading);
    assert.equal(themes.path, 'pages/board-tab/index'); assert.equal((await themes.data()).isTab, true); assert.equal((await themes.data()).themes.length, 2);
    assert.equal((await themes.data()).themes.find(b => b.id === 'theme_life').count, 2); assert.equal((await mini.pageStack()).length, 1);
    await capture('06-theme-tab');
    checks.push('home retains explicit export/photo-detail access; second tab lists only fixed themes and includes cross-day memories');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    if (mini) {
      if (pickerMocked) await mini.restoreWxMethod(picker).catch(() => {});
      if (modalMocked) await mini.restoreWxMethod('showModal').catch(() => {});
      if (backup) {
        // Close any live component before restoring user storage so its unload cannot write into it.
        await mini.evaluate(() => { const page = getCurrentPages().slice(-1)[0]; if (page) page.setData({ editorOpen: false, memoryCardId: '' }); }); await pause(300);
        if (isolated) await mini.evaluate(key => { const raw = wx.getStorageSync(key); if (!raw) return; const s = JSON.parse(raw); const files = Object.values(s.memories).flatMap(m => [m.originalPath, m.subjectPath]).concat(s.garbage || []); for (const file of files) if (file.startsWith(`${wx.env.USER_DATA_PATH}/felt-journal/`)) { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} } }, keys[0]);
        await mini.evaluate(items => items.forEach(item => item.exists ? wx.setStorageSync(item.key, item.value) : wx.removeStorageSync(item.key)), backup);
        assert.deepEqual(await mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys), backup); storageRestored = true;
      }
      await mini.evaluate(files => files.forEach(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }), testFiles);
      await mini.evaluate(() => { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({}); });
      await mini.reLaunch('/pages/index/index').catch(() => {}); mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output, 'acceptance.json'), JSON.stringify({ passed: true, recordedAt: new Date().toISOString(), storageRestored, checks, screenshots, limitations: ['System picker mocked with test photos; physical camera, keyboard and touch require phone acceptance', 'Remote extraction not exercised'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
