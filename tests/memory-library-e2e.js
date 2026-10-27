/* Native UI acceptance using bundled icons and an isolated journal snapshot.
 * Restores the user's storage exactly, including on failure. No remote photos. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:active-theme:v1'];
const output = path.resolve(__dirname, '../artifacts/memory-library');
const captureScreenshots = !process.argv.includes('--no-screenshots');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms || 120));
(async () => {
  let mini, backup, home;
  const checks = [], errors = [];
  async function wait(target, predicate) {
    for (let i = 0; i < 90; i++) { const data = await target.data(); if (predicate(data)) return data; await pause(); }
    const data = await target.data(); throw Error(`State timeout: ${JSON.stringify({ path: target.path, loading: data.loading, error: data.error, drawer: data.drawer, libraryOpen: data.libraryOpen, memoryCardId: data.memoryCardId, libraryPickerOpen: data.libraryPickerOpen, photoLibraryOpen: data.photoLibraryOpen })}`);
  }
  async function tap(target, selector) {
    console.log('Tap', selector); const item = await target.$(selector); assert.ok(item, selector);
    try { await item.tap(); } catch (error) { throw Error(`Tap failed ${selector}: ${error.message}`); }
    console.log('Tapped', selector); await pause(220);
  }
  async function snapshot() { return JSON.parse(await mini.callWxMethod('getStorageSync', keys[0])); }
  async function capture(name) { if (captureScreenshots) { await pause(400); await mini.screenshot({ path: path.join(output, `${name}.png`) }); } }
  async function geometry(component, selector) {
    return mini.evaluate((component, selector) => new Promise(resolve => {
      const page = getCurrentPages().slice(-1)[0], target = component.split(' ').filter(Boolean).reduce((p, id) => p.selectComponent(id), page);
      target.createSelectorQuery().select(selector).boundingClientRect(resolve).exec();
    }), component, selector);
  }
  async function more() {
    // These controls overlap the native board's extended top edge. Send a real
    // canvas touch at the DOM button's location to verify overhang forwarding.
    const themeMode = (await home.data()).mode === 'themes';
    const rect = await geometry('', themeMode ? '#theme-options' : '#calendar-options');
    const touch = { identifier: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    const canvas = await (await home.$('#today-board')).$('#feltCanvas');
    await mini.evaluate(() => {
      const p=getCurrentPages().slice(-1)[0], original=p.setData;
      p.__menuAudit={original};
      p.setData=function(update,done){
        if(update.drawer==='calendar-options'||update.drawer==='theme') {
          const b=this.selectComponent('#today-board');
          this.__menuAudit.before={hidden:b.data.canvasHidden,occluded:b.data.occluded,raster:!!b.data.snapshot && b.data.snapshotVisible};
        }
        return original.call(this,update,done);
      };
    });
    let before;
    try {
      await canvas.touchstart({ touches: [touch], changedTouches: [touch] }); await pause(100);
      await canvas.touchend({ touches: [], changedTouches: [touch] });
      await wait(home, d => d.drawer === (themeMode ? 'theme' : 'calendar-options'));
    } finally {
      before=await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0],a=p.__menuAudit;p.setData=a.original;delete p.__menuAudit;return a.before;});
    }
    assert.deepEqual(before,{hidden:true,occluded:true,raster:true},'The decoded board replaces the native canvas before the first menu frame');
    if (themeMode) {
      for (const selector of ['#theme-appearance', '#open-memory-libraries', '#rename-theme', '#delete-theme']) assert.ok(await home.$(selector), selector);
      assert.equal(await home.$('#share-theme'), null, 'Sharing stays in the board header, without a duplicate menu entry');
    } else assert.equal((await home.$$('.calendar-options-menu button')).length, 2);
    const board = await home.$('#today-board'); await wait(board, d => d.canvasHidden && d.occluded);
  }
  async function openLibrary() { await more(); await tap(home, '#open-memory-libraries'); await wait(home, d => d.libraryOpen); return home.$('#memory-library-card'); }
  async function openObject(id) {
    await mini.evaluate(id => { const b = getCurrentPages().slice(-1)[0].selectComponent('#today-board'); b.gesture = { item: b.data.model.items.find(item => item.memoryId === id) }; b.touchEnd(); }, id);
    await wait(home, d => d.memoryCardId === id);
    const card = await home.$('#memory-card'); await wait(card, d => d.memory && !d.pickupBusy); return card;
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    assert.equal(await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return !!(p && (p.dirty || p.noteDirty || p.photoTask || p.busy && p.busy())); }), false, 'Finish any active editor before running acceptance');
    backup = await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys);
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'storage-backup.json'), JSON.stringify(backup));
    mini.on('exception', e => errors.push(e));
    const disk = {}, store = createStore({ get: k => disk[k], set: (k, v) => { disk[k] = v; } }), today = dates.key();
    const fixture = { originalPath: '/images/navigation/board-active.png', subjectPath: '/images/navigation/today-active.png', width: 72, height: 72, kind: 'original' };
    const one = store.add('library_one', today, fixture), two = store.add('library_two', today, { ...fixture, subjectPath: '/images/navigation/calendar-active.png' });
    const result = store.add('library_result', today, fixture, today, { deferPlacement: true });
    store.edit(one, '散步时遇见的一点小美好\n把今天的阳光留在这里。', '日常');
    const a = store.createLibrary('walks', '散步收集'), b = store.createLibrary('daily', '日常碎片');
    store.setMemoryLibraries(one, [a]); store.setMemoryLibraries(two, [a]);
    const theme = store.createTheme('library_theme', '周末的小美好', one);
    store.commit(state => { state.localNoticeSeen = true; for (let i = 0; i < 36; i++) { const id = `m_fixture_${i}`; state.memories[id] = { ...state.memories[two], id, text: `小物 ${i}`, createdAt: i }; state.libraries[a].memoryIds.push(id); } });
    store.edit('m_fixture_35', '长长的小记\n'.repeat(100), '日常');
    await mini.evaluate((names, state, theme) => { names.forEach(key => wx.removeStorageSync(key)); wx.setStorageSync(names[0], state); wx.setStorageSync(names[4], theme); }, keys, disk[keys[0]], theme);
    home = await mini.reLaunch('/pages/index/index'); await wait(home, d => !d.loading && !d.error); await pause(500);
    await more(); await capture('01-calendar-more'); await tap(home, '#calendar-appearance'); await wait(home, d => d.drawer === 'appearance');
    await home.callMethod('texture', { currentTarget: { dataset: { value: 'long' } } }); await home.callMethod('closeDrawer');
    assert.equal((await snapshot()).boards[today].texture, 'long');
    checks.push('Calendar native overhang touch opens exactly two choices; appearance persists to the current date');
    let lib = await openLibrary(); await wait(lib, d => d.loaded); await capture('02-library-list');
    const bounds = await geometry('#memory-library-card', '.library-card');
    await tap(lib, `.library-folder[data-id="${a}"]`); await wait(lib, d => d.libraryId === a);
    assert.equal((await lib.data()).items.length, 38); assert.equal((await lib.data()).visibleItems.length, 30);
    const detailBounds = await geometry('#memory-library-card', '.library-card');
    for (const key of ['top', 'height', 'width']) assert.equal(detailBounds[key], bounds[key], 'One card keeps its size while drilling into a library');
    for (const selector of ['#library-back', '#library-options', '#close-library-card', '.library-object']) {
      const rect = await geometry('#memory-library-card', selector);
      assert.ok(rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom, `${selector} stays inside the card`);
      assert.ok(rect.width >= 44 && rect.height >= 44, `${selector} retains its touch target`);
    }
    const objectBounds = await mini.evaluate(() => new Promise(resolve => getCurrentPages().slice(-1)[0].selectComponent('#memory-library-card').createSelectorQuery().selectAll('.library-object').boundingClientRect(resolve).exec()));
    const longNote = objectBounds[(await lib.data()).visibleItems.findIndex(item => item.id === 'm_fixture_35')];
    assert.ok(longNote.height <= 230, 'Long notes remain a short preview instead of stretching the gallery');
    await capture('03-library-objects');
    await tap(lib, `.library-object[data-id="${one}"]`); await wait(home, d => d.memoryCardId === one);
    let card = await home.$('#memory-card'); await wait(card, d => !!d.memory);
    assert.equal(await (await lib.$('.memory-library-overlay')).style('visibility'), 'hidden');
    await tap(card, '#flip-card'); await wait(card, d => d.flipped && !d.flipBusy);
    assert.equal((await card.data()).memory.text, store.get().memories[one].text); await capture('04-object-note');
    await tap(card, '#add-to-memory-library'); await wait(card, d => d.libraryPickerOpen);
    let picker = await card.$('#memory-library-picker'); await wait(picker, d => d.loaded);
    await tap(picker, `.library-folder[data-id="${b}"]`); await capture('05-pick-libraries');
    await tap(picker, '#confirm-library-selection'); await wait(card, d => !d.libraryPickerOpen);
    assert.equal((await card.data()).flipped, true); assert.equal((await card.data()).libraryCount, 2);
    await tap(card, '#close-memory-card'); await wait(home, d => !d.memoryCardId);
    assert.equal((await lib.data()).libraryId, a); assert.equal(await (await lib.$('.memory-library-overlay')).style('visibility'), 'visible');
    const scroll = await lib.$('#library-objects'); await scroll.scrollTo(0, 1450); await pause(300);
    await lib.callMethod('more'); await wait(lib, d => d.visibleItems.length === 38);
    const position = await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#memory-library-card').galleryScrollTop);
    assert.ok(position > 0);
    // Use a currently mounted gallery item; verify returning restores scroll data.
    await lib.callMethod('openMemory', { currentTarget: { dataset: { id: 'm_fixture_35' } } }); await wait(home, d => !!d.memoryCardId);
    card = await home.$('#memory-card'); await wait(card, d => !!d.memory); await tap(card, '#close-memory-card'); await wait(home, d => !d.memoryCardId);
    assert.equal((await lib.data()).scrollTop, position);
    await tap(lib, '#library-back'); await tap(lib, '#create-library');
    await lib.callMethod('nameInput', { detail: { value: '旅途拾光' } }); await tap(lib, '#save-library-name'); await wait(lib, d => !d.formOpen && d.libraryTitle === '旅途拾光');
    const created = (await lib.data()).libraryId; assert.ok((await snapshot()).libraries[created]);
    await tap(lib, '#close-library-card'); await wait(home, d => !d.libraryOpen);
    const board = await home.$('#today-board'); await wait(board, d => !d.canvasHidden && !d.covered);
    checks.push('Same-card library gallery, 38-object pagination, scroll recall, flip note, multi-library save and inline creation');
    await home.callMethod('switchMode'); await wait(home, d => d.mode === 'themes' && d.date === theme); await pause(700);
    await more(); await capture('08-theme-more'); await tap(home, '#theme-appearance'); await wait(home, d => d.drawer === 'appearance');
    await tap(home, '#close-drawer');
    const themeBeforeBrowse = (await snapshot()).boards[theme];
    lib = await openLibrary(); await wait(lib, d => d.loaded);
    assert.equal((await lib.data()).libraries.find(item => item.id === b).count, 1, 'Calendar and theme share the same libraries');
    await tap(lib, `.library-folder[data-id="${b}"]`); await tap(lib, `.library-object[data-id="${one}"]`);
    await wait(home, d => d.memoryCardId === one); card = await home.$('#memory-card'); await wait(card, d => !!d.memory);
    await tap(card, '#flip-card'); await wait(card, d => d.flipped && !d.flipBusy); assert.equal((await card.data()).memory.text, store.get().memories[one].text);
    await tap(card, '#close-memory-card'); await wait(home, d => !d.memoryCardId); assert.equal((await lib.data()).libraryId, b);
    await tap(lib, '#close-library-card'); await wait(home, d => !d.libraryOpen);
    assert.equal((await home.data()).date, theme); assert.equal((await home.data()).mode, 'themes');
    assert.deepEqual((await snapshot()).boards[theme], themeBeforeBrowse);
    checks.push('Theme native more menu opens appearance and shared libraries; gallery flip and return preserve the current board');
    card = await openObject(one); await tap(card, '#add-to-memory-library'); await wait(card, d => d.libraryPickerOpen);
    picker = await card.$('#memory-library-picker'); await wait(picker, d => d.loaded); assert.equal((await picker.data()).selectionCount, 2);
    await tap(picker, `.library-folder[data-id="${b}"]`); await tap(picker, '#close-library-card'); await wait(card, d => !d.libraryPickerOpen);
    assert.ok((await snapshot()).libraries[b].memoryIds.includes(one), 'Cancel discards pending membership changes');
    await tap(card, '#close-memory-card'); await wait(home, d => !d.memoryCardId); await home.callMethod('switchMode'); await wait(home, d => d.mode === 'calendar'); await pause(700);
    card = await openObject(two); await tap(card, '#add-to-memory-library'); await wait(card, d => d.libraryPickerOpen);
    picker = await card.$('#memory-library-picker'); await wait(picker, d => d.loaded); await tap(picker, '#close-library-card'); await wait(card, d => !d.libraryPickerOpen); await tap(card, '#close-memory-card'); await wait(home, d => !d.memoryCardId);
    checks.push('Objects on both calendar and theme boards expose the same picker; cancellation leaves membership intact');
    await tap(home, '#record-today'); await wait(home, d => d.editorOpen);
    const record = await home.$('#record-card'); await wait(record, d => !d.loading);
    // Inject only the completed photo task; task persistence/extraction is unit
    // tested separately. UI events below exercise the actual result-to-library wiring.
    await mini.evaluate((id, date) => {
      const c = getCurrentPages().slice(-1)[0].selectComponent('#record-card'), m = c.store.get().memories[id];
      c.photoTask = { savedId: id, committed: true, state: 'done', deferPlacement: true, date, targetBoardId: date, originalPath: m.originalPath, subjectPath: m.subjectPath };
      c.photoNoteId = id;
      c.setData({ task: { id: 'fixture_result', state: 'done', memoryId: id, original: m.originalPath, subject: m.subjectPath, kind: m.kind, committed: true }, photoNoteText: '', sourceStage: false });
    }, result, today);
    const panel = await record.$('#record-photo'); await wait(panel, d => d.done && !d.revealBusy);
    await capture('06-photo-result'); await tap(panel, '#photo-add-library'); await wait(record, d => d.photoLibraryOpen);
    picker = await record.$('#photo-library'); await wait(picker, d => d.loaded);
    const pickBounds = await geometry('#record-card #photo-library', '.memory-library-overlay'), info = await mini.systemInfo();
    assert.equal(pickBounds.top, 0); assert.ok(Math.abs(pickBounds.height - info.windowHeight) < 1, 'Nested picker covers the viewport, outside the clipped photo card');
    await tap(picker, `.library-folder[data-id="${created}"]`); await capture('07-photo-library'); await tap(picker, '#confirm-library-selection'); await wait(record, d => !d.photoLibraryOpen);
    assert.equal((await record.data()).photoLibraryTitle, '旅途拾光'); assert.ok((await snapshot()).libraries[created].memoryIds.includes(result));
    await tap(record, '#close-record'); await wait(home, d => !d.editorOpen);
    let state = await snapshot(); assert.equal(state.boards[today].placements.some(p => p.memoryId === result), false, 'Closing a completed result never places the object');
    assert.equal(state.memories[one].text, store.get().memories[one].text); assert.deepEqual(state.boards[theme], store.get().boards[theme]);
    await mini.reLaunch('/pages/index/index'); home = await mini.currentPage(); await wait(home, d => !d.loading); await pause(500);
    lib = await openLibrary(); await wait(lib, d => d.loaded); assert.ok((await lib.data()).libraries.find(item => item.id === created && item.count === 1));
    await tap(lib, '#close-library-card'); await wait(home, d => !d.libraryOpen);
    checks.push('Completed photo result can join a library; nested picker fills viewport; closing does not place; memberships survive reload');
    assert.deepEqual(errors, []);
    console.log(checks.map(text => `PASS: ${text}`).join('\n'));
  } finally {
    if (mini) {
      if (backup) {
        await mini.evaluate(items => { const p = getCurrentPages().slice(-1)[0]; if (p && p.onHide) p.onHide(); items.forEach(item => item.value === '' ? wx.removeStorageSync(item.key) : wx.setStorageSync(item.key, item.value)); }, backup);
        await mini.reLaunch('/pages/index/index'); await pause(700);
        assert.deepEqual(await mini.evaluate(names => names.map(key => ({ key, value: wx.getStorageSync(key) })), keys), backup);
        console.log('PASS: original storage restored exactly');
      }
      await mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, storageRestored: true, captureScreenshots, checks }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
