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
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let mini, backup;
  const errors = [], checks = [];
  async function wait(predicate) {
    for (let i = 0; i < 60; i++) { const p = await mini.currentPage(), data = await p.data(); if (predicate(data)) return data; await pause(150); }
    throw new Error('Timed out waiting for journal state');
  }
  async function call(method, value) { await mini.evaluate((method, value) => getCurrentPages().slice(-1)[0][method](value), method, value); await pause(180); }
  async function tap(selector) { const page = await mini.currentPage(), element = await page.$(selector); assert.ok(element, `Missing ${selector}`); await element.tap(); await pause(180); }
  async function tapCanvasAction(action) {
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
    await canvas.touchend({touches:[],changedTouches:[touch]}); await pause(180);
  }
  async function inspect(name) {
    const result = await mini.evaluate(() => new Promise(resolve => {
      const page = getCurrentPages().slice(-1)[0], info = wx.getSystemInfoSync();
      const selectors = ['#switch-mode','.journal-rail','.today-sheet','.today-stage','#record-today','.journal-picker-card'];
      const query = wx.createSelectorQuery(); selectors.forEach(s => query.select(s).boundingClientRect());
      query.selectAll('.journal-day,.journal-theme,.journal-more').boundingClientRect();
      query.selectAll('#selected-tools,#return-today').boundingClientRect();
      query.exec(values => resolve({ mode:page.data.mode, error:page.data.error, width:info.windowWidth, height:info.windowHeight, rects:values.slice(0,selectors.length), rail:values[selectors.length], quickActions:values[selectors.length+1] }));
    }));
    const page=await mini.currentPage(), dock=await page.$('.record-dock'), button=await page.$('#record-today');
    result.dock={ 'pointer-events':await dock.style('pointer-events'), visibility:await dock.style('visibility') };
    result.add={ 'pointer-events':await button.style('pointer-events') };
    const boardLayout=await mini.evaluate(()=>new Promise(resolve=>{
      const board=getCurrentPages().slice(-1)[0].selectComponent('#today-board');
      board.createSelectorQuery().select('.board-viewport').boundingClientRect().select('.board-shell').boundingClientRect().exec(([viewport,rect])=>resolve({viewport,actions:board.data.actions.map(a=>({action:a.action,left:rect.left+a.x,top:rect.top+a.y,width:a.width,height:a.height}))}));
    }));
    result.boardBounds=boardLayout.viewport; result.nativeControls=boardLayout.actions;
    assert.equal(result.error, '', name);
    result.rects.filter(Boolean).forEach(r => { assert.ok(r.left >= -1 && r.right <= result.width+1, `${name} horizontal overflow ${JSON.stringify(r)}`); assert.ok(r.top >= -1 && r.bottom <= result.height+1, `${name} vertical overflow ${JSON.stringify(r)}`); });
    result.rail.forEach(r => assert.ok(r.width >= 43 && r.height >= 44, `${name} touch target ${JSON.stringify(r)}`));
    const tabVisible = await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0], tab = p.getTabBar && p.getTabBar(); return !!(tab && tab.selectComponent('#main-nav')); });
    assert.equal(tabVisible, false);
    const stage = result.rects[3], add = result.rects[4];
    assert.ok(Math.abs(stage.top-result.boardBounds.top-12)<1 && Math.abs(stage.bottom-result.boardBounds.bottom-12)<1, 'Only the felt board is raised 12px within the notebook');
    assert.ok(stage.bottom >= result.height - 16, 'Board extends close to the screen bottom');
    assert.ok(add.top >= stage.top && add.bottom <= stage.bottom - 10, 'Add button floats inside the board with bottom clearance');
    assert.ok(add.height >= 44 && add.width >= 44, 'Floating add button retains its touch target');
    assert.equal(result.dock['pointer-events'], 'none', 'Empty space around floating controls passes touches to the board');
    assert.equal(result.add['pointer-events'], 'auto', 'Floating add button remains interactive');
    if (!result.rects[5]) {
      const native=result.nativeControls.find(a=>a.action==='record'); assert.ok(native,'Native canvas paints the add control');
      for (const key of ['left','top','width','height']) assert.ok(Math.abs(native[key]-add[key])<1,`Native paint and accessible button agree on ${key}`);
    }
    result.quickActions.forEach(r => {
      assert.ok(r.height >= 44 && r.left >= 0 && r.right <= result.width, 'Quick actions remain reachable');
      assert.ok(r.top >= stage.top && r.bottom <= stage.bottom && r.left >= add.right, 'Quick actions float beside the add button');
    });
    checks.push({ name, ...result });
    console.log('PASS layout:', name);
    if (captureScreenshots) { await pause(250); await mini.screenshot({ path:path.join(output, `${checks.length}-${name}.png`) }); }
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
    store.commit(s=>{[a,b,c,d].forEach((id,i)=>{s.boards[id].createdAt=i+1;s.boards[id].updatedAt=i+1;});s.localNoticeSeen=true;});
    await mini.evaluate((keys,snapshot,active)=>{keys.forEach(k=>wx.removeStorageSync(k));wx.setStorageSync(keys[0],snapshot);wx.setStorageSync(keys[4],active);},keys,disk[keys[0]],b);
    console.log('Installed isolated fixtures');
    await mini.reLaunch('/pages/index/index');
    await wait(data=>!data.loading&&data.mode==='calendar');
    let page=await mini.currentPage(); assert.equal((await page.data()).date,today); console.log('Journal page ready');
    await inspect('calendar-board');
    await tap(`.journal-day[data-date="${past}"]`); await wait(data=>data.date===past);
    await tap('#switch-mode'); await wait(data=>data.mode==='themes'&&data.date===b);
    await tap(`.journal-theme[data-id="${c}"]`); await wait(data=>data.date===c);
    await tap('#switch-mode'); assert.equal((await (await mini.currentPage()).data()).date,past);
    await tap('#switch-mode'); assert.equal((await (await mini.currentPage()).data()).date,c);
    await inspect('theme-board');
    await tap('#journal-more'); await inspect('all-themes-card');
    await tap(`.journal-theme-choice[data-id="${a}"]`); await wait(data=>data.date===a&&!data.journalPicker);
    await tapCanvasAction('record'); await wait(data=>data.drawer==='source'); await tap('#source-library'); await wait(data=>data.drawer==='library');
    await call('toggleLibrary',{currentTarget:{dataset:{id:two}}}); await tap('#add-library-selection');
    let data=await wait(data=>data.count===2&&!data.working); assert.equal(data.themeRail.find(t=>t.id===a).latestId,two); assert.equal(data.navigationBusy,false);
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
    assert.deepEqual(errors,[]);
    console.log('PASS: selection recall, latest thumbnail, library placement, sharing, empty-day recording and six-week calendar');
  } finally {
    if (mini) {
      if (backup) {
        console.log('Restoring original storage');
        await mini.evaluate(items=>{const p=getCurrentPages().slice(-1)[0];if(p&&p.onHide)p.onHide();items.forEach(item=>item.value===''?wx.removeStorageSync(item.key):wx.setStorageSync(item.key,item.value));},backup);
        await mini.reLaunch('/pages/index/index');
        await pause(500);
        assert.deepEqual(await mini.evaluate(names=>names.map(key=>({key,value:wx.getStorageSync(key)})),keys),backup);
      }
      mini.disconnect();
    }
  }
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({passed:true,storageRestored:true,captureScreenshots,checks},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
