/* Category lookup acceptance in the native WeChat simulator. The test owns only
 * two uniquely named fixture files and restores all journal storage in finally.
 * Do not edit/recompile the mini-program while its storage is isolated. */
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
  let mini, backup, files = [];
  const errors = [], checks = [], screenshots = [];
  async function wait(page, predicate) {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const data = await page.data(); if (predicate(data)) return data;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`Timed out on ${page.path}: ${JSON.stringify(await page.data())}`);
  }
  async function route(expected) {
    const start = Date.now();
    while (Date.now() - start < 15000) {
      const page = await mini.currentPage(); if (page && page.path === expected) return page;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    throw new Error(`Did not reach ${expected}`);
  }
  async function top() { await mini.callWxMethod('pageScrollTo', { scrollTop: 0, duration: 0 }); }
  async function capture(name) {
    if (process.env.WECHAT_SCREENSHOTS !== '1') return;
    try { await top(); await new Promise(resolve => setTimeout(resolve, 800)); await mini.screenshot({ path: path.join(output, name) }); screenshots.push(name); }
    catch (error) { console.warn(`Screenshot skipped (${name}): ${error.message}`); }
  }
  const rows = data => data.groups.flatMap(group => group.items);
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    mini.on('exception', error => errors.push(error));
    fs.mkdirSync(output, { recursive: true });
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    const fixture = createCanvas(120, 120), context = fixture.getContext('2d');
    context.fillStyle = '#4D7D5B'; context.beginPath(); context.ellipse(60, 60, 30, 48, .6, 0, Math.PI * 2); context.fill();
    context.strokeStyle = '#F7F2E9'; context.lineWidth = 3; context.beginPath(); context.moveTo(34, 102); context.lineTo(82, 24); context.stroke();
    files = await mini.evaluate((base64, stamp) => ['original', 'subject'].map(kind => {
      const file = `${wx.env.USER_DATA_PATH}/felt-filter-e2e-${stamp}-${kind}.png`;
      wx.getFileSystemManager().writeFileSync(file, base64, 'base64'); return file;
    }), fixture.toBuffer('image/png').toString('base64'), `${Date.now()}-${process.pid}`);
    const raw = {}, store = createStore({ get: key => raw[key], set: (key, value) => { raw[key] = value; } });
    const today = dates.key(), now = new Date(`${today}T12:00:00`);
    const oldDate = dates.key(new Date(now.getFullYear(), now.getMonth() - 1, 1)), oldMonth = oldDate.slice(0, 7);
    const emptyMonth = dates.key(new Date(now.getFullYear(), now.getMonth() - 2, 1)).slice(0, 7);
    const photos = { originalPath: files[0], subjectPath: files[1], width: 120, height: 120, kind: 'extracted' };
    for (const [index, category] of ['饮食', '自然', '未分类'].entries()) {
      const id = store.add(`filter_today_${index}`, today, photos); store.edit(id, ['早晨的一杯热茶', '散步时遇见一片叶子', '留着慢慢整理的小日常'][index], category);
    }
    for (let index = 0; index < 25; index++) {
      const id = store.add(`filter_old_${index}`, oldDate, photos); store.edit(id, `上个月的生活记忆 ${index + 1}`, '饮食');
    }
    store.commit(state => { state.localNoticeSeen = true; Object.values(state.memories).forEach((memory, index) => { memory.createdAt = index + 1; }); });
    const seeded = raw[keys[0]];
    await mini.evaluate((names, snapshot) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], snapshot); }, keys, seeded);
    console.log('STEP: isolated 28 memories across two months');
    let home = await mini.reLaunch('/pages/index/index'); await wait(home, data => !data.loading);
    assert.equal((await home.data()).count, 3);
    await (await home.$('#find-memories')).tap(); let page = await route('pages/memories/index');
    let data = await wait(page, value => !value.loading && value.total === 28);
    assert.equal(data.scope, 'all'); assert.equal(data.categories.length, 7); assert.equal(rows(data).length, 20); assert.equal(data.pageCount, 2);
    await (await page.$('#category-1')).tap(); data = await wait(page, value => value.category === '饮食');
    assert.equal(data.total, 26); assert.equal(data.scopeTotal, 28);
    await capture('wechat-category-filter.png');
    await (await page.$('#next-page')).tap(); data = await wait(page, value => value.page === 2);
    assert.equal(rows(data).length, 6); assert.equal(await mini.callWxMethod('getStorageSync', keys[0]), seeded);
    checks.push('home opens all-time lookup; 7 counted categories; native category tap and 20-item pagination without storage writes');
    console.log('STEP: read-only filtering passed; editing one result');
    const movedId = rows(data)[0].id;
    await (await page.$('.memory-row')).tap(); let memory = await route('pages/memory/index'); await wait(memory, value => !value.loading);
    assert.equal((await memory.data()).memory.id, movedId); assert.equal((await memory.data()).backLabel, '返回筛选结果');
    await memory.callMethod('edit'); await memory.callMethod('categoryInput', { detail: { value: '2' } }); await memory.callMethod('save');
    assert.equal((await memory.data()).memory.category, '自然'); await memory.callMethod('back');
    page = await route('pages/memories/index'); data = await wait(page, value => value.total === 25);
    assert.equal(data.category, '饮食'); assert.equal(data.page, 2); assert.equal(rows(data).length, 5);
    assert.equal(data.categories.find(category => category.value === '自然').count, 2);
    assert.ok(!rows(data).some(item => item.id === movedId));
    await (await page.$('.memory-row')).tap(); memory = await route('pages/memory/index'); await wait(memory, value => !value.loading);
    await mini.mockWxMethod('showModal', { confirm: true, cancel: false }); await memory.callMethod('remove');
    page = await route('pages/memories/index'); data = await wait(page, value => value.total === 24);
    await mini.restoreWxMethod('showModal'); assert.equal(data.page, 2); assert.equal(rows(data).length, 4);
    checks.push('detail origin label; recategorization/removal refresh results and counts while retaining category and page');
    await (await page.$('.date-heading button')).tap(); const board = await route('pages/board/index');
    const boardData = await wait(board, value => !value.loading); assert.equal(boardData.count, 24);
    assert.equal(boardData.model.items.filter(item => item.memory.category === '自然').length, 1);
    await mini.navigateBack(); page = await route('pages/memories/index'); await wait(page, value => !value.loading);
    assert.equal((await page.data()).page, 2);
    checks.push('view entire board includes other categories and returns to the same filter page');
    console.log('STEP: detail and board return passed; checking empty and monthly scopes');
    await top(); await (await page.$('#category-3')).tap(); data = await wait(page, value => value.category === '出行');
    assert.equal(data.total, 0); assert.equal(data.page, 1); assert.ok(await page.$('#clear-category'));
    await capture('wechat-category-empty.png');
    await (await page.$('#clear-category')).tap(); data = await wait(page, value => value.category === ''); assert.equal(data.total, 27);
    await (await page.$('#category-6')).tap(); data = await wait(page, value => value.category === '未分类'); assert.equal(data.total, 1);
    let calendar = await mini.reLaunch('/pages/calendar/index'); await wait(calendar, value => !value.loading);
    await calendar.callMethod('previous'); const previousCalendar = await calendar.data();
    await (await calendar.$('#find-month-memories')).tap(); page = await route('pages/memories/index');
    data = await wait(page, value => !value.loading); assert.equal(data.scope, 'month'); assert.equal(data.month, oldMonth); assert.equal(data.total, 24);
    await (await page.$('#category-1')).tap(); data = await wait(page, value => value.category === '饮食'); assert.equal(data.total, 23);
    await (await page.$('#scope-all')).tap(); data = await wait(page, value => value.scope === 'all'); assert.equal(data.total, 24);
    await (await page.$('#scope-month')).tap(); await wait(page, value => value.scope === 'month');
    await (await page.$('#month-picker')).trigger('change', { value: emptyMonth }); data = await wait(page, value => value.month === emptyMonth);
    assert.equal(data.total, 0); assert.equal(data.scopeTotal, 0);
    await page.callMethod('back'); calendar = await route('pages/calendar/index');
    assert.equal((await calendar.data()).month, previousCalendar.month); assert.equal((await calendar.data()).year, previousCalendar.year);
    checks.push('empty-result recovery, unclassified records, calendar month entry, category/month intersection, picker change and return month');
    assert.equal(errors.length, 0, JSON.stringify(errors));
  } finally {
    if (mini) {
      await mini.restoreWxMethod('showModal').catch(() => {});
      if (backup) await mini.evaluate(items => items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)), backup);
      if (files.length) await mini.evaluate(paths => paths.forEach(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }), files);
      await mini.evaluate(() => { if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({}); }).catch(() => {});
      await mini.reLaunch('/pages/index/index').catch(() => {}); mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output, 'wechat-category-e2e.json'), JSON.stringify({ passed: true, recordedAt: new Date().toISOString(), checks, screenshots,
    limitations: ['Synthetic isolated memories and thumbnails', 'Month picker change event injected; physical picker interaction pending', 'Physical device layout and touch checks pending'] }, null, 2));
  console.log('PASS:', checks.join('\nPASS: '));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
