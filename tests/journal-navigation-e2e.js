/* Uses illustrated fixtures in an isolated storage snapshot; always restores
 * journal data and preferences before removing only this run's fixture files. */
const automator = require('miniprogram-automator');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const navigation = require('../miniprogram/core/journal-navigation');
const dragControl = require('./helpers/drag-control');
const keys = ['felt-journal:v1','felt-journal:drafts:v1','felt-journal:memory-drafts:v1','felt-journal:dev-extraction:v1','felt-journal:active-theme:v1'];
const output = path.resolve(__dirname, '../artifacts/journal-navigation');
const captureScreenshots = !process.argv.includes('--no-screenshots');
const pickerScreenshots = process.argv.includes('--picker-screenshots');
const guideScreenshots = process.argv.includes('--guide-screenshots');
const bookmarkScreenshots = process.argv.includes('--bookmark-screenshots');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let mini, backup;
  const errors = [], checks = [];
  async function wait(predicate) {
    for (let i = 0; i < 60; i++) { const p = await mini.currentPage(), data = await p.data(); if (predicate(data)) return data; await pause(150); }
    throw new Error('Timed out waiting for journal state');
  }
  async function call(method, value) { await mini.evaluate((method, value) => getCurrentPages().slice(-1)[0][method](value), method, value); await pause(180); }
  async function settleBoard() {
    for(let i=0;i<80;i++) {
      const ready=await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0],b=p.selectComponent('#today-board');return !b || !b.data.navigationAnimating && !b.journalSource && (b.data.covered || b.displayModel && b.data.model && b.data.model.id===p.data.date && b.displayModel.id===b.data.model.id);});
      if(ready)return;await pause(40);
    }
    throw Error('Board transition did not settle');
  }
  async function assertPickerOccluded() {
    await mini.evaluate(()=>new Promise(resolve=>wx.nextTick(resolve)));
    const state=await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0],b=p.selectComponent('#today-board');return {picker:p.data.journalPicker,closing:p.data.pickerClosing,occluded:b.data.occluded,hidden:b.data.canvasHidden,snapshot:b.data.snapshotVisible,ready:!!b.data.snapshot};});
    assert.ok(state.picker && state.occluded && state.hidden,'Picker always suppresses native canvas, including its first frame');
    assert.ok(state.snapshot && state.ready,'A decoded board raster is ready before picker entry');
    const board=await (await mini.currentPage()).$('#today-board'),canvas=await board.$('#feltCanvas');
    assert.equal(await canvas.style('display'),'none','Native canvas is actually removed from the compositor');
  }
  async function assertBoardTransition(id) {
    let running = false;
    for (let i = 0; i < 40; i++) {
      running = await mini.evaluate(id => {
        const b = getCurrentPages().slice(-1)[0].selectComponent('#today-board');
        return b.data.navigationAnimating && b.data.model.id === id;
      }, id);
      if (running) break; await pause(10);
    }
    assert.equal(running, true, 'The selected board uses the native calendar crossfade');
    await settleBoard();
  }
  async function tap(selector) {
    if(selector==='#switch-mode') {
      const board=await (await mini.currentPage()).$('#today-board');
      if(board){await tapCanvasAction('mode');return;}
    }
    const page=await mini.currentPage(),element=await page.$(selector);assert.ok(element,`Missing ${selector}`);
    const before=selector==='#switch-mode' ? await page.data() : null;
    await element.tap();
    if(before && !before.modeSwitchExpanded) {
      await wait(data=>data.modeSwitchExpanded);assert.equal(await page.data('mode'),before.mode,'Empty-theme first tap only expands');
      await pause(200);await element.tap();await wait(data=>data.modeSwitchExpanded && data.mode!==before.mode);
    }
    if(selector==='#journal-more'){await wait(data=>!!data.journalPicker&&!data.pickerPreparing);await assertPickerOccluded();}
    if(selector==='#close-journal-picker')await assertPickerOccluded();
    await pause(180);if(selector==='#close-journal-picker')await wait(data=>!data.journalPicker);
  }
  async function tapCanvasAction(action, expandOnly=false) {
    await settleBoard();
    const before=action==='mode' ? await (await mini.currentPage()).data() : null;
    const touch=await mini.evaluate(action=>new Promise(resolve=>{
      const board=getCurrentPages().slice(-1)[0].selectComponent('#today-board');
      board.createSelectorQuery().select('.board-shell').boundingClientRect(rect=>{
        const target=board.data.actions.find(a=>a.action===action);
        resolve(target ? {identifier:0,clientX:rect.left+target.x+target.width/2,clientY:rect.top+target.y+target.height/2} : null);
      }).exec();
    }),action);
    assert.ok(touch,`Native canvas exposes ${action}`);
    const canvas=await (await (await mini.currentPage()).$('#today-board')).$('#feltCanvas');
    await canvas.touchstart({touches:[touch],changedTouches:[touch]}); await pause(120);
    await canvas.touchend({touches:[],changedTouches:[touch]}); await pause(180);await settleBoard();
    if(before) {
      const after=await (await mini.currentPage()).data();
      if(!before.modeSwitchExpanded) {
        assert.equal(after.mode,before.mode,'First native tap only expands the bookmark');assert.equal(after.date,before.date);
        assert.equal(after.modeSwitchExpanded,true);assert.equal(after.memoryCardId,before.memoryCardId,'Expansion never opens the object behind the handle');
        if(!expandOnly)await tapCanvasAction('mode');
      } else { assert.notEqual(after.mode,before.mode,'Second native tap switches modes');assert.equal(after.modeSwitchExpanded,true,'Switching keeps the bookmark expanded'); }
    }
  }
  async function inspect(name) {
    await settleBoard();
    const result = await mini.evaluate(() => new Promise(resolve => {
      const page = getCurrentPages().slice(-1)[0], info = wx.getSystemInfoSync();
      const selectors = ['.journal-topbar','.journal-rail','.today-sheet','.today-stage','#record-today','.journal-picker-card'];
      const query = wx.createSelectorQuery(); selectors.forEach(s => query.select(s).boundingClientRect());
      query.selectAll('.journal-day,.journal-theme,.journal-more').boundingClientRect();
      query.selectAll('#selected-tools,#return-today').boundingClientRect();
      query.exec(values => resolve({ mode:page.data.mode, error:page.data.error, width:info.windowWidth, height:info.windowHeight, statusBar:info.statusBarHeight, menu:wx.getMenuButtonBoundingClientRect(), headerStatus:page.data.headerStatus, headerTitle:page.data.headerTitle, rects:values.slice(0,selectors.length), rail:values[selectors.length], quickActions:values[selectors.length+1] }));
    }));
    const page=await mini.currentPage(), dock=await page.$('.record-dock'), button=await page.$('#record-today');
    result.dock={ 'pointer-events':await dock.style('pointer-events'), visibility:await dock.style('visibility') };
    result.add={ 'pointer-events':await button.style('pointer-events') };
    const boardLayout=await mini.evaluate(()=>new Promise(resolve=>{
      const board=getCurrentPages().slice(-1)[0].selectComponent('#today-board');
      board.createSelectorQuery().select('.board-viewport').boundingClientRect().select('.board-shell').boundingClientRect().select('#feltCanvas').boundingClientRect().exec(([viewport,rect,canvas])=>resolve({viewport,canvas,canvasHidden:board.data.canvasHidden,renderedSize:{width:board.data.width,height:board.data.height,canvasHeight:board.data.canvasHeight},actions:board.data.actions.map(a=>({action:a.action,left:rect.left+a.x,top:rect.top+a.y,width:a.width,height:a.height}))}));
    }));
    result.boardBounds=boardLayout.viewport; result.canvasBounds=boardLayout.canvas; result.renderedSize=boardLayout.renderedSize; result.nativeControls=boardLayout.actions;
    const baseline=checks.find(check=>check.name==='calendar-board');
    if(baseline) {
      for(const bounds of boardLayout.canvasHidden ? ['boardBounds'] : ['boardBounds','canvasBounds'])for(const key of ['left','top','width','height','bottom'])assert.ok(Math.abs(result[bounds][key]-baseline[bounds][key])<1,`${name}: ${bounds} ${key} stays fixed across modes and empty boards`);
      for(const key of ['width','height','canvasHeight'])assert.ok(Math.abs(result.renderedSize[key]-baseline.renderedSize[key])<1,`${name}: rendered board ${key} stays fixed`);
    }
    assert.equal(result.error, '', name);
    assert.equal(result.headerStatus,result.statusBar,'Custom header retains the native status-bar safe area');
    assert.ok(result.rects[0].bottom>=result.menu.bottom,'Date title and native capsule share one navigation row');
    assert.ok(result.rects[1].height<=68,'Compact date and theme rails do not restore the large heading gap');
    result.rects.filter(Boolean).forEach(r => { assert.ok(r.left >= -1 && r.right <= result.width+1, `${name} horizontal overflow ${JSON.stringify(r)}`); assert.ok(r.top >= -1 && r.bottom <= result.height+1, `${name} vertical overflow ${JSON.stringify(r)}`); });
    result.rail.forEach(r => assert.ok(r.width >= 43 && r.height >= 44, `${name} touch target ${JSON.stringify(r)}`));
    const tabVisible = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0], tab = p.getTabBar && p.getTabBar(); return !!(tab && tab.selectComponent('#main-nav')); });
    assert.equal(tabVisible, false);
    const stage = result.rects[3], add = result.rects[4];
    assert.ok(Math.abs(stage.top-result.boardBounds.top-42)<1 && Math.abs(stage.bottom-result.boardBounds.bottom-42)<1, 'Only the felt board is raised 42px within the notebook');
    assert.ok(stage.bottom >= result.height - 16, 'Board extends close to the screen bottom');
    assert.ok(add.top >= stage.top && add.bottom <= stage.bottom - 10, 'Add button floats inside the board with bottom clearance');
    assert.ok(add.height >= 44 && add.width >= 44, 'Floating add button retains its touch target');
    assert.equal(result.dock['pointer-events'], 'none', 'Empty space around floating controls passes touches to the board');
    assert.equal(result.add['pointer-events'], 'auto', 'Floating add button remains interactive');
    if (!result.rects[5]) {
      const bookmark=result.nativeControls.find(a=>a.action==='mode');assert.ok(bookmark,'Native canvas exposes the side bookmark');
      assert.equal(bookmark.width,44);assert.ok(bookmark.top>result.canvasBounds.top && bookmark.top+bookmark.height<result.canvasBounds.bottom);
      assert.ok(Math.abs(bookmark.left+bookmark.width-result.canvasBounds.right)<1,'Bookmark aligns with the right edge');
      const native=result.nativeControls.find(a=>a.action==='record'); assert.ok(native,'Native canvas paints the add control');
      assert.ok(native.top+native.height<=result.canvasBounds.bottom-1,'Floating button is fully painted below the raised board');
      for (const key of ['left','top','width','height']) assert.ok(Math.abs(native[key]-add[key])<1,`Native paint and accessible button agree on ${key}`);
    }
    result.quickActions.forEach(r => {
      assert.ok(r.height >= 44 && r.left >= 0 && r.right <= result.width, 'Quick actions remain reachable');
      assert.ok(r.top >= stage.top && r.bottom <= stage.bottom && r.left >= add.right, 'Quick actions float beside the add button');
    });
    checks.push({ name, ...result });
    console.log('PASS layout:', name);
    if (captureScreenshots && (guideScreenshots ? ['empty-theme-board','historical-day'].includes(name) : !pickerScreenshots || name.endsWith('card') || name==='six-week-calendar')) { await pause(320); await mini.screenshot({ path:path.join(output, `${checks.length}-${name}.png`) }); }
    console.log('PASS:', name);
    return result;
  }
  try {
    mini = await automator.connect({ wsEndpoint:process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    console.log('Connected to WeChat automation');
    const occupied = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0]; return !!(p && (p.dirty || p.noteDirty || p.photoTask || p.data.editorOpen || p.data.placing || p.data.memoryCardId || p.data.shareBoardId)); });
    assert.equal(occupied, false, 'Finish the active editor before running the isolated acceptance test');
    backup = await mini.evaluate(names => names.map(key => ({ key, value:wx.getStorageSync(key) })), keys);
    mini.on('exception', error => errors.push(error));
    fs.mkdirSync(output, { recursive:true });
    fs.writeFileSync(path.join(output,'storage-backup.json'),JSON.stringify(backup));
    console.log('Saved isolated-test storage backup');
    // Reuse bundled public icon images; no user photos or remote services.
    const originalPath='/images/navigation/board-active.png', subjectPath='/images/navigation/today-active.png';
    const fixture = { originalPath, subjectPath, width:72, height:72, kind:'original' };
    const disk = {}, store = createStore({ get:k=>disk[k], set:(k,v)=>{disk[k]=v;} });
    const today=dates.key(), past=navigation.dateAt(today,-2), empty=navigation.dateAt(today,-3);
    const one=store.add('journal_one',today,fixture), two=store.add('journal_two',today,{...fixture,subjectPath:'/images/navigation/calendar-active.png'}), older=store.add('journal_older',past,fixture);
    const a=store.createTheme('journal_a','日常碎片',one), b=store.createTheme('journal_b','散步收集',two), c=store.createTheme('journal_c','旅行足迹',older), d=store.createTheme('journal_d','等待第一件记忆的长名称主题板');
    store.place(older,a);
    store.commit(s=>{[a,b,c,d].forEach((id,i)=>{s.boards[id].createdAt=i+1;s.boards[id].updatedAt=i+1;});s.localNoticeSeen=true;});
    await mini.evaluate((keys,snapshot,active)=>{keys.forEach(k=>wx.removeStorageSync(k));wx.setStorageSync(keys[0],snapshot);wx.setStorageSync(keys[4],active);},keys,disk[keys[0]],b);
    console.log('Installed isolated fixtures');
    await mini.callWxMethod('reLaunch',{url:'/pages/index/index'});await pause(700);
    await wait(data=>!data.loading&&data.mode==='calendar');
    let page=await mini.currentPage(); assert.equal((await page.data()).date,today); console.log('Journal page ready');
    await inspect('calendar-board');
    assert.equal(await page.data('modeSwitchExpanded'),false,'The bookmark starts tucked away');
    if(bookmarkScreenshots)await mini.screenshot({path:path.join(output,'bookmark-collapsed.png')});
    await tapCanvasAction('mode',true);
    if(bookmarkScreenshots)await mini.screenshot({path:path.join(output,'bookmark-expanded.png')});
    await tap('.journal-title');assert.equal(await page.data('modeSwitchExpanded'),false,'Tapping outside dismisses the bookmark');
    await tapCanvasAction('mode',true);await pause(1300);
    await tapCanvasAction('mode');await pause(1700);
    assert.equal(await page.data('modeSwitchExpanded'),true,'The previous expansion timeout cannot close the switch after a new tap');
    await tapCanvasAction('mode');await pause(1700);
    assert.equal(await page.data('modeSwitchExpanded'),true,'Repeated switching restarts the three-second idle delay');
    await wait(data=>!data.modeSwitchExpanded);
    assert.equal(await page.data('mode'),'calendar','Idle collapse does not change the current board');
    console.log('PASS: mode switch stays expanded across changes, renews its idle timer and collapses after inactivity');
    await mini.evaluate(()=>getCurrentPages().slice(-1)[0].switchMode());
    let animating=false;for(let i=0;i<30;i++){animating=await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#today-board').data.navigationAnimating);if(animating)break;await pause(10);}
    assert.equal(animating,true,'A real native canvas transition runs when changing modes');
    await tap('#journal-more');await tap('#close-journal-picker');await settleBoard();
    await tap('#switch-mode');await settleBoard();
    await tap(`.journal-day[data-date="${past}"]`); await wait(data=>data.date===past);
    await tap('#switch-mode'); await wait(data=>data.mode==='themes'&&data.date===b);
    await tap(`.journal-theme[data-id="${c}"]`); await wait(data=>data.date===c); await assertBoardTransition(c);
    await tap('#switch-mode'); assert.equal((await (await mini.currentPage()).data()).date,past);
    await tap('#switch-mode'); assert.equal((await (await mini.currentPage()).data()).date,c);
    await inspect('theme-board');
    await tap('#journal-more');await tap(`.journal-theme-choice[data-id="${d}"]`);await wait(data=>data.date===d&&!data.journalPicker);await assertBoardTransition(d);await inspect('empty-theme-board');
    await tap('#journal-more'); await inspect('all-themes-card');
    const themePair=await (await mini.currentPage()).$(`.journal-theme-choice[data-id="${a}"]`);
    assert.equal((await themePair.$$('image')).length,2,'Theme chooser displays two actual objects');
    await tap(`.journal-theme-choice[data-id="${a}"]`); await wait(data=>data.date===a&&!data.journalPicker);
    await tapCanvasAction('record'); await wait(data=>data.drawer==='source'); await tap('#source-library'); await wait(data=>data.drawer==='library');
    await call('toggleLibrary',{currentTarget:{dataset:{id:two}}}); await tap('#add-library-selection');
    let data=await wait(data=>data.count===3&&!data.working); assert.equal(data.themeRail.find(t=>t.id===a).latestId,two); assert.equal(data.navigationBusy,false);
    await call('clearSelection'); const browsing = await inspect('theme-browsing');
    await call('editItem',{detail:{id:two}}); const arranging = await inspect('theme-arrangement');
    assert.equal(arranging.rects[3].height,browsing.rects[3].height,'Selection keeps the expanded board height');
    const board = await (await mini.currentPage()).$('#today-board');
    await dragControl(mini,board,'#today-board','rotate',8,{ onMove:async()=>{
      const state=await (await mini.currentPage()).data(); assert.equal(state.dragging,true);
      assert.deepEqual(await board.data('actions'),[],'Native floating controls also disappear during gestures');
      const dock=await (await mini.currentPage()).$('.record-dock');
      assert.equal(await dock.style('visibility'),'hidden','Floating controls hide during an actual object gesture');
    }});
    await wait(data=>!data.dragging&&!data.navigationBusy);
    const released=await (await mini.currentPage()).$('.record-dock');
    assert.equal(await released.style('visibility'),'visible','Floating controls return after the gesture');
    await tapCanvasAction('tools'); await wait(data=>data.drawer==='selection'); await call('closeDrawer');
    await call('exportToday'); await wait(data=>!!data.shareBoardId); await call('closeShareCard');
    await tap('#switch-mode'); await wait(data=>data.mode==='calendar');
    await tap('#journal-more'); await wait(data=>data.journalPicker==='calendar'); await inspect('calendar-card');
    const datePair=await (await mini.currentPage()).$(`.journal-calendar-day[data-date="${today}"]`);
    assert.equal((await datePair.$$('image')).length,2,'Month chooser displays two actual objects for the date');
    const previews=await (await mini.currentPage()).data('previewReady');
    assert.ok(Object.keys(previews).length>=2,'Loaded object previews fade into view');
    await call('chooseDate',{currentTarget:{dataset:{date:empty}}}); data=await wait(data=>data.date===empty&&!data.journalPicker);
    assert.equal(data.canEdit,true); assert.equal(data.count,0);
    await inspect('historical-day');
    await tapCanvasAction('record'); data=await wait(data=>data.editorOpen); assert.equal(data.editorDate,empty);
    const recordError=await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#record-card').data.error);assert.equal(recordError,'');
    await call('closeEditor'); await tapCanvasAction('today'); await wait(data=>data.date===today);
    await tap('#journal-more');
    await mini.evaluate(()=>{const p=getCurrentPages().slice(-1)[0];p.journalYear=2026;p.journalMonth=8;p.refreshCalendar();});
    assert.equal((await (await mini.currentPage()).data()).calendarCells.length,42);await inspect('six-week-calendar');
    await tap('#close-journal-picker');
    const before=await mini.evaluate(()=>wx.getStorageSync('felt-journal:v1')); await tap('#switch-mode'); await tap('#switch-mode');
    assert.equal(await mini.evaluate(()=>wx.getStorageSync('felt-journal:v1')),before,'Browsing modes never writes board data');
    const blankDisk={}, blankStore=createStore({get:k=>blankDisk[k],set:(k,v)=>{blankDisk[k]=v;}});
    blankStore.commit(s=>{s.localNoticeSeen=true;});
    await mini.evaluate((keys,snapshot)=>{keys.forEach(k=>wx.removeStorageSync(k));wx.setStorageSync(keys[0],snapshot);},keys,blankDisk[keys[0]]);
    await mini.callWxMethod('reLaunch',{url:'/pages/index/index'});await pause(700);await wait(data=>!data.loading);
    await tap('#switch-mode');await wait(data=>data.mode==='themes'&&!data.date);
    const blankPage=await mini.currentPage(),fallback=await blankPage.$('#switch-mode');
    assert.ok(fallback,'First-time theme mode keeps a reachable bookmark without a native board');
    await tap('#switch-mode');await wait(data=>data.mode==='calendar');
    assert.equal((await (await mini.currentPage()).data()).date,today);
    assert.deepEqual(errors,[]);
    console.log('PASS: selection recall, latest thumbnail, library placement, sharing, empty-day recording, six-week calendar and empty-theme return');
  } finally {
    if (mini) {
      if (backup) {
        console.log('Restoring original storage');
        await mini.evaluate(items=>{const p=getCurrentPages().slice(-1)[0];if(p&&p.onHide)p.onHide();items.forEach(item=>item.value===''?wx.removeStorageSync(item.key):wx.setStorageSync(item.key,item.value));},backup);
        await mini.callWxMethod('reLaunch',{url:'/pages/index/index'});await pause(700);
        await pause(500);
        assert.deepEqual(await mini.evaluate(names=>names.map(key=>({key,value:wx.getStorageSync(key)})),keys),backup);
      }
      mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,storageRestored:true,captureScreenshots,checks},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
