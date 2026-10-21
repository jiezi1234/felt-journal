/* Native theme/placement acceptance. Isolates and restores all journal storage.
 * Do not edit or recompile the mini-program while this test is running. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const output = path.resolve(__dirname, '../artifacts');
const pause = () => new Promise(resolve => setTimeout(resolve, 150));
const rows = data => data.groups.flatMap(group => group.items);
(async () => {
  let mini, backup, files = [], storageRestored = false, environment, modalMocked = false;
  const errors = [], checks = [], screenshots = [];
  async function wait(page, predicate) {
    const start = Date.now();
    while (Date.now() - start < 15000) { const data = await page.data(); if (predicate(data)) return data; await pause(); }
    throw new Error(`Timed out on ${page.path}: ${JSON.stringify(await page.data())}`);
  }
  async function route(expected) {
    const start = Date.now();
    while (Date.now() - start < 15000) { const page = await mini.currentPage(); if (page && page.path === expected) return page; await pause(); }
    throw new Error(`Did not reach ${expected}`);
  }
  async function state() { return JSON.parse(await mini.callWxMethod('getStorageSync', keys[0])); }
  async function capture(name) {
    if (process.env.WECHAT_SCREENSHOTS !== '1' && !(process.env.WECHAT_THEME_LIST_SCREENSHOT === '1' && name === 'wechat-themes.png')) return;
    await mini.callWxMethod('hideToast', {});
    await mini.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 }); await new Promise(resolve => setTimeout(resolve, 800));
    try { await mini.screenshot({ path: path.join(output, name) }); screenshots.push(name); }
    catch (error) { console.warn(`Screenshot skipped (${name}): ${error.message}`); }
  }
  async function newTheme(page, title) {
    await (await page.$('#new-theme')).tap(); await wait(page, data => data.formOpen);
    await page.callMethod('input', { detail: { value: title } }); await wait(page, data => data.title === title);
    await (await page.$('#save-theme')).tap();
  }
  async function pick(board, id, expectedCount) {
    await board.callMethod('edit'); await (await board.$('#add-from-library')).tap();
    const picker = await route('pages/memories/index'); await wait(picker, data => !data.loading && data.targetId);
    const item = await picker.$(`.memory-row[data-id="${id}"]`); assert.ok(item); await item.tap();
    board = await route('pages/board/index'); await wait(board, data => data.count === expectedCount && data.selected === id && data.editable);
    return board;
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', error => errors.push(error)); fs.mkdirSync(output, { recursive: true });
    const device = await mini.systemInfo(); environment = { platform: device.platform, model: device.model, SDKVersion: device.SDKVersion, width: device.windowWidth };
    backup = await mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys);
    console.log('STEP: connected and backed up journal storage');
    const canvas = createCanvas(160, 160), ctx = canvas.getContext('2d');
    ctx.fillStyle = '#4D7D5B'; ctx.beginPath(); ctx.ellipse(80, 80, 42, 65, .45, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#F7F2E9'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(48, 140); ctx.lineTo(106, 26); ctx.stroke();
    files = await mini.evaluate((bytes, stamp) => ['original', 'subject'].map(kind => {
      const file = `${wx.env.USER_DATA_PATH}/felt-themes-e2e-${stamp}-${kind}.png`;
      wx.getFileSystemManager().writeFileSync(file, bytes, 'base64'); return file;
    }), canvas.toBuffer('image/png').toString('base64'), `${Date.now()}-${process.pid}`);
    // A second visible color proves that the exported board contains both
    // placements, rather than accepting two exactly overlapping fixtures.
    ctx.fillStyle = '#C47740'; ctx.fillRect(30, 30, 100, 100);
    const warmFiles = await mini.evaluate((bytes, stamp) => ['original', 'subject'].map(kind => {
      const file = `${wx.env.USER_DATA_PATH}/felt-themes-warm-e2e-${stamp}-${kind}.png`;
      wx.getFileSystemManager().writeFileSync(file, bytes, 'base64'); return file;
    }), canvas.toBuffer('image/png').toString('base64'), `${Date.now()}-${process.pid}`);
    files.push(...warmFiles);
    const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
    const today = dates.key(), current = new Date(`${today}T12:00:00`);
    const old = dates.key(new Date(current.getFullYear(), current.getMonth() - 1, 1));
    const photo = { originalPath: files[0], subjectPath: files[1], width: 160, height: 160, kind: 'extracted' };
    const first = store.add('theme_today_1', today, photo), second = store.add('theme_today_2', today, photo), past = store.add('theme_past', old, { ...photo, originalPath: warmFiles[0], subjectPath: warmFiles[1] });
    store.edit(first, '公园里捡到的一片叶子', '自然'); store.edit(second, '窗边的午后', '未分类'); store.edit(past, '上个月的散步', '出行');
    store.commit(s => { s.localNoticeSeen = true; });
    const legacy = store.get(); legacy.version = 1; Object.values(legacy.boards).forEach(board => { delete board.membershipRevision; });
    const seeded = JSON.stringify(legacy), originalPlacement = legacy.boards[old].placements[0];
    await mini.evaluate((names, snapshot) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], snapshot); }, keys, seeded);
    console.log('STEP: isolated legacy fixture installed');
    let home = await mini.reLaunch('/pages/index/index'); await wait(home, data => !data.loading); assert.equal((await home.data()).count, 2);
    assert.equal(await mini.callWxMethod('getStorageSync', keys[0]), seeded);
    await mini.evaluate(() => getCurrentPages().slice(-1)[0].getTabBar().selectComponent('#main-nav').open({ currentTarget: { dataset: { id: 'board' } } }));
    let themes = await route('pages/board-tab/index'); await wait(themes, data => !data.loading);
    assert.equal((await themes.data()).themes.length, 0); await newTheme(themes, '秋日拾遗');
    const inlineCreated = await wait(themes, data => !data.formOpen && data.isTheme && data.editable);
    assert.equal((await mini.currentPage()).path, 'pages/board-tab/index');
    // The tab now creates/edits in place; exercise the standalone editor below
    // directly for legacy layout/crop compatibility, without expecting a jump.
    await mini.evaluate(url => new Promise((resolve, reject) => wx.navigateTo({ url, success: () => resolve(true), fail: e => reject(new Error(e.errMsg)) })), `/pages/board/index?board=${inlineCreated.date}&mode=edit`);
    let board = await route('pages/board/index'); let data = await wait(board, data => !data.loading && data.isTheme && data.editable);
    const theme1 = data.date; assert.equal(data.count, 0); assert.equal(data.dateLabel, '秋日拾遗'); assert.equal((await state()).version, 2);
    checks.push('legacy v1 read preserves raw snapshot; native theme tab creates in place and upgrades to v2 only on successful save; standalone editor opened explicitly for compatibility');
    console.log('STEP: theme creation and legacy upgrade passed; checking cross-date placement');
    board = await pick(board, past, 1);
    assert.equal(Object.keys((await state()).memories).length, 3);
    await board.callMethod('transform', { detail: { op: 'cw' } });
    data = await wait(board, value => value.model.placements[0].angle !== 0 && value.saveState === '已保存');
    assert.deepEqual((await state()).boards[old].placements[0], originalPlacement);
    await mini.mockWxMethod('showModal', { confirm: false, cancel: true }); modalMocked = true; await board.callMethod('remove'); assert.equal((await board.data()).count, 1);
    await mini.mockWxMethod('showModal', { confirm: true, cancel: false }); modalMocked = true; await board.callMethod('remove'); await wait(board, value => value.count === 0);
    assert.ok((await state()).memories[past]); assert.equal((await board.data()).canUndo, false); await board.callMethod('undo'); assert.equal((await board.data()).count, 0);
    board = await pick(board, past, 1); board = await pick(board, first, 2);
    const items = (await board.data()).model.placements;
    for (const placement of items) await board.callMethod('placementChanged', { detail: { placement: { ...placement, x: placement.memoryId === past ? 370 : 1030, y: 440 } } });
    await board.callMethod('library'); let picker = await route('pages/memories/index'); data = await wait(picker, value => !value.loading && value.total === 3);
    assert.equal(data.groups.length, 2); assert.equal(rows(data).filter(item => item.placed).length, 2);
    assert.equal(String(await (await picker.$(`.memory-row[data-id="${past}"]`)).attribute('disabled')), 'true');
    await picker.callMethod('back'); board = await route('pages/board/index'); await wait(board, value => value.count === 2);
    checks.push('cross-month native picker uses EventChannel to return selected item; independent layout, removal cancel/confirm, retained source and duplicate prevention');
    await board.callMethod('memory', { detail: { id: past } }); const memoryCard = await board.$('#memory-card');
    assert.equal(await memoryCard.$('#memory-options'), null); await (await memoryCard.$('#flip-card')).tap(); await wait(memoryCard, value => value.flipped);
    await (await memoryCard.$('#edit-card-note')).tap(); await wait(memoryCard, value => value.editing);
    await memoryCard.callMethod('input', { detail: { value: '秋日散步，在路边发现的小美好' } }); await (await memoryCard.$('#save-card-note')).tap();
    await wait(memoryCard, value => !value.editing && value.memory.text === '秋日散步，在路边发现的小美好');
    await (await memoryCard.$('#add-to-theme')).tap(); data = await wait(memoryCard, value => value.themeOpen);
    assert.equal(data.themes.find(item => item.id === theme1).placed, true);
    await capture('wechat-card-theme-picker.png');
    await (await memoryCard.$('#new-card-theme')).tap(); await wait(memoryCard, value => value.themeCreating);
    await memoryCard.callMethod('themeInput', { detail: { value: '旅途的小纪念' } }); await (await memoryCard.$('#save-card-theme')).tap();
    await wait(memoryCard, value => !value.themeOpen); assert.equal((await mini.currentPage()).path, board.path);
    await (await memoryCard.$('#close-memory-card')).tap();
    // Direct legacy route retains photo editing compatibility coverage without a card entry.
    await mini.evaluate(url => new Promise((resolve, reject) => wx.navigateTo({ url, success: () => resolve(true), fail: e => reject(new Error(e.errMsg)) })), `/pages/memory/index?id=${encodeURIComponent(past)}&from=theme`); let memory = await route('pages/memory/index'); data = await wait(memory, value => !value.loading);
    assert.equal(data.backLabel, '返回主题板'); assert.equal(data.usageCount, 3);
    const theme2 = Object.values((await state()).boards).find(item => item.title === '旅途的小纪念').id;
    const beforeCrop = (await memory.data()).memory, beforeBoards = (await state()).boards;
    const originalBytes = await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), beforeCrop.originalPath);
    await (await memory.$('#adjust-image')).tap(); const crop = await route('pages/photo-edit/index'); await wait(crop, value => value.ready && !value.loading);
    await (await crop.$('#rotate-image')).tap(); await wait(crop, value => value.dirty);
    await (await crop.$('#save-image')).tap(); memory = await route('pages/memory/index');
    const afterCrop = (await wait(memory, value => value.memory && value.memory.subjectEdited)).memory; files.push(afterCrop.subjectPath);
    assert.notEqual(afterCrop.subjectPath, beforeCrop.subjectPath); assert.equal(afterCrop.originalPath, beforeCrop.originalPath);
    assert.equal(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), afterCrop.originalPath), originalBytes);
    assert.deepEqual((await state()).boards, beforeBoards);
    await memory.callMethod('back'); board = await route('pages/board/index'); data = await wait(board, value => value.model.items.some(item => item.memory.text === '秋日散步，在路边发现的小美好'));
    assert.equal(data.date, theme1); assert.equal(data.count, 2);
    assert.equal(data.model.items.find(item => item.memoryId === past).memory.subjectPath, afterCrop.subjectPath);
    assert.equal((await state()).memories[past].date, old);
    await board.callMethod('done'); await wait(board, value => !value.editable); await capture('wechat-theme-board.png');
    await (await board.$('#export-board')).tap(); const exported = await board.$('#share-card'); data = await wait(exported, value => !value.generating);
    assert.equal(data.error, ''); assert.equal(data.isTheme, true); assert.equal(data.dateLabel, '秋日拾遗');
    const info = await mini.callWxMethod('getImageInfo', { src: data.imagePath }); assert.deepEqual([info.width, info.height], [1800, 1392]);
    const png = Buffer.from(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), data.imagePath), 'base64');
    fs.writeFileSync(path.join(output, 'wechat-theme-artwork.png'), png);
    const outputCanvas = createCanvas(1800, 1392), pixels = outputCanvas.getContext('2d'); pixels.drawImage(await loadImage(png), 0, 0);
    for (const [x, color] of [[370, [196, 119, 64]], [1030, [77, 125, 91]]]) {
      const patch = pixels.getImageData(Math.round((45 + x) * 1.2) - 48, Math.round((160 + 45 + 440) * 1392/1160) - 48, 96, 96).data; let matches = 0;
      for (let index = 0; index < patch.length; index += 4) if (color.every((value, channel) => Math.abs(patch[index + channel] - value) <= 2) && patch[index + 3] === 255) matches++;
      assert.ok(matches > 1000, `Native export must show the subject at x=${x}, got ${matches} matching pixels`);
    }
    await capture('wechat-theme-export.png');
    checks.push('shared text and native image correction update one memory across three boards while all layouts/original bytes stay unchanged; native 1800x1392 export contains the clamp and both separately positioned colors');
    console.log('STEP: shared content and theme export passed; checking removal boundaries');
    home = await mini.reLaunch('/pages/index/index'); await wait(home, value => !value.loading); assert.equal((await home.data()).count, 2);
    board = await mini.navigateTo(`/pages/board/index?date=${old}&mode=edit`); data = await wait(board, value => !value.loading);
    assert.equal(data.model.items[0].memory.text, '秋日散步，在路边发现的小美好');
    assert.equal(data.model.items[0].memory.subjectPath, afterCrop.subjectPath);
    board = await mini.reLaunch(`/pages/board/index?board=${theme2}`); data = await wait(board, value => !value.loading);
    assert.equal(data.model.items[0].memory.subjectPath, afterCrop.subjectPath); assert.deepEqual(data.model.placements, beforeBoards[theme2].placements);
    themes = await mini.reLaunch('/pages/themes/index'); await wait(themes, value => !value.loading && value.themes.length === 2);
    const longTitle = '秋日散步与旅行途中收集的那些值得珍藏的小小日常和温柔时光记忆'; assert.equal(Array.from(longTitle).length, 30);
    await themes.callMethod('rename', { currentTarget: { dataset: { id: theme1 } } }); await wait(themes, value => value.formOpen);
    await (await themes.$('#theme-title')).input(longTitle); await (await themes.$('#save-theme')).tap();
    await wait(themes, value => !value.formOpen && value.themes.some(item => item.title === longTitle));
    const card = await themes.$('.theme-card'), open = await themes.$('.theme-open');
    const cardSize = await card.size(), openSize = await open.size();
    const inset = (await Promise.all(['padding-left', 'padding-right', 'border-left-width', 'border-right-width'].map(name => card.style(name)))).reduce((sum, value) => sum + parseFloat(value || 0), 0);
    const contentWidth = Number(cardSize.width) - inset;
    assert.ok(Math.abs(Number(openSize.width) - contentWidth) <= 1, `Theme button must fill the actual card content box: ${openSize.width}/${contentWidth}`);
    const name = await themes.$('.theme-name'), heading = await themes.$('.theme-heading');
    assert.ok(Number((await name.size()).width) < Number((await heading.size()).width), 'Long name must leave space for item count');
    await capture('wechat-themes.png');
    checks.push(`native 30-character theme name wraps inside full-width card (${openSize.width}px content in ${cardSize.width}px card)`);
    await themes.callMethod('open', { currentTarget: { dataset: { id: theme1 } } }); board = await route('pages/board/index');
    data = await wait(board, value => !value.loading); assert.equal(data.dateLabel, longTitle); assert.equal(data.count, 2);
    await board.callMethod('back'); themes = await route('pages/themes/index'); await wait(themes, value => !value.working);
    await themes.callMethod('remove', { currentTarget: { dataset: { id: theme2 } } }); await wait(themes, value => value.themes.length === 1);
    let snapshot = await state(); assert.ok(snapshot.memories[past]); assert.ok(snapshot.boards[theme1].placements.some(item => item.memoryId === past));
    assert.equal(snapshot.boards[old].placements.length, 1); assert.equal(snapshot.boards[theme2], undefined);
    await themes.callMethod('open', { currentTarget: { dataset: { id: theme1 } } }); board = await route('pages/board/index'); await wait(board, value => !value.loading);
    await board.callMethod('memory', { detail: { id: past } }); assert.equal(await (await board.$('#memory-card')).$('#memory-options'), null); await board.callMethod('closeMemoryCard'); /* Direct legacy route for shared-data compatibility, not a card entry. */ await mini.evaluate(url => new Promise((resolve, reject) => wx.navigateTo({ url, success: () => resolve(true), fail: e => reject(new Error(e.errMsg)) })), `/pages/memory/index?id=${encodeURIComponent(past)}&from=theme`); memory = await route('pages/memory/index'); await wait(memory, value => !value.loading);
    await memory.callMethod('remove'); board = await route('pages/board/index'); await wait(board, value => value.count === 1);
    snapshot = await state(); assert.equal(snapshot.memories[past], undefined);
    assert.ok(Object.values(snapshot.boards).every(item => item.placements.every(p => p.memoryId !== past)));
    assert.equal(Object.keys(snapshot.memories).length, 2);
    checks.push('relaunch retains themes without polluting daily counts; rename persists; deleting a theme retains shared memory, global delete removes every placement');
    board = await mini.reLaunch(`/pages/board/index?date=${today}&mode=edit`); await wait(board, value => !value.loading);
    await board.callMethod('select', { detail: { id: second } }); await board.callMethod('remove'); await wait(board, value => value.count === 1);
    assert.ok((await state()).memories[second]); await board.callMethod('library'); picker = await route('pages/memories/index');
    data = await wait(picker, value => !value.loading); assert.equal(data.targetDaily, true); assert.equal(data.total, 2); assert.equal(data.groups.length, 1);
    assert.equal(rows(data).find(item => item.id === second).placed, false);
    await (await picker.$(`.memory-row[data-id="${second}"]`)).tap(); board = await route('pages/board/index'); await wait(board, value => value.count === 2 && value.selected === second);
    checks.push('last placement removal keeps memory in library; native daily picker restores only that date and preserves other layouts');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    if (mini) {
      if (modalMocked) await mini.restoreWxMethod('showModal').catch(() => {});
      if (backup) {
        await mini.evaluate(() => { const page = getCurrentPages().slice(-1)[0]; if (page) page.setData({ memoryCardId: '' }); });
        await mini.evaluate(items => items.forEach(item => item.exists ? wx.setStorageSync(item.key, item.value) : wx.removeStorageSync(item.key)), backup);
        assert.ok(JSON.stringify(await mini.evaluate(names => names.map(key => ({ key, exists: wx.getStorageInfoSync().keys.includes(key), value: wx.getStorageSync(key) })), keys)) === JSON.stringify(backup), 'Original storage must be restored exactly'); storageRestored = true;
      }
      if (files.length) await mini.evaluate(paths => paths.forEach(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }), files);
      await mini.evaluate(() => { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({}); }).catch(() => {});
      await mini.reLaunch('/pages/index/index').catch(() => {}); mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output, 'wechat-themes-e2e.json'), JSON.stringify({ passed: true, recordedAt: new Date().toISOString(), environment, storageRestored, checks, screenshots,
    limitations: ['Synthetic isolated photos and records', 'Modal responses mocked; no real messages sent', 'Physical-device touch, keyboard, restart and sharing acceptance pending'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
