// Second-round UI acceptance against an isolated in-memory journal.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const pause = ms => new Promise(r => setTimeout(r, ms));
const keys = ['felt-journal:v1','felt-journal:drafts:v1','felt-journal:memory-drafts:v1','felt-journal:dev-extraction:v1','felt-journal:server-extraction:v1'];
(async () => {
  let mini, backup, info, installed = false;
  const checks = [], errors = [], output = path.resolve('artifacts/round2');
  const snapshot = () => mini.evaluate(keys => keys.map(key => ({ key, value:wx.getStorageSync(key), exists:wx.getStorageInfoSync().keys.includes(key) })), keys);
  const state = () => mini.evaluate(() => {
    const p = getCurrentPages().slice(-1)[0];
    return { guide:p.data.showBoardGuide, saved:p.data.layoutSaved, error:p.data.saveError, learned:!!require('core/store.js').getStore().get().boardGuideSeen };
  });
  async function until(fn, label) { for (let n=0;n<80;n++) { if (await fn()) return; await pause(100); } throw Error('Timed out: '+label); }
  const act = (chain, method, arg) => mini.evaluate((chain, method, arg) => chain.reduce((p,s)=>p.selectComponent(s),getCurrentPages().slice(-1)[0])[method](arg),chain,method,arg);
  async function bounds(chain, selectors) {
    await pause(350);
    return mini.evaluate((chain, selectors) => new Promise(resolve => {
      const owner = chain.reduce((p,s)=>p.selectComponent(s),getCurrentPages().slice(-1)[0]), q=owner.createSelectorQuery();
      selectors.forEach(s=>q.select(s).boundingClientRect()); q.exec(resolve);
    }),chain,selectors);
  }
  try {
    mini = await automator.connect({ wsEndpoint:process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    info = await mini.systemInfo(); assert.equal(info.platform,'devtools'); fs.mkdirSync(output,{recursive:true});
    mini.on('exception',e=>errors.push(e));
    await mini.evaluate(() => {
      for (const p of getCurrentPages()) if (p.dirty || p.noteDirty || p.photoTask || p.data.editable || p.data.editorOpen || p.data.memoryCardId || p.data.shareBoardId || p.data.boardDate) throw Error('Finish current editing first');
    });
    backup=await snapshot(); await mini.callWxMethod('switchTab',{url:'/pages/index/index'});
    installed=true;
    await mini.evaluate(() => {
      const module=require('core/store.js'), store=module.getStore(), disk={}, app=getApp();
      const q=app.__round2={ original:{...store}, fail:false };
      const isolated=module.createStore({get:key=>disk[key],set(key,value){if(q.fail)throw Error('write failed');disk[key]=value;}});
      const date=require('core/date.js').key(); q.id=isolated.add('polish',date,{originalPath:'/images/navigation/board-active.png',subjectPath:'/images/navigation/today-active.png',width:72,height:72});
      isolated.commit(s=>{s.localNoticeSeen=true;}); Object.assign(store,isolated);
      const p=getCurrentPages().slice(-1)[0]; p.guideLearned=false; p.setData({editable:false,selected:'',layoutSaved:false}); p.refresh();
    });
    let page=await mini.currentPage();
    console.log('STEP: isolated journal; navigation');
    assert.equal((await state()).guide,true);
    const record=await page.$('#record-today');
    const nav=await mini.evaluate(()=>{
      const nav=getCurrentPages().slice(-1)[0].getTabBar().selectComponent('#main-nav');
      return {active:nav.data.active,labels:nav.data.items.map(x=>x.label)};
    });
    assert.ok((await record.text()).includes('再记一件'));
    assert.equal(await record.style('background-color'),'rgb(23, 23, 22)');
    assert.equal(nav.active,'today'); assert.deepEqual(nav.labels,['主题板','今天','月历时光']);
    checks.push('navigation and record action have different visual hierarchy with readable labels');
    await mini.screenshot({path:path.join(output,'today-'+info.windowWidth+'.png')});
    console.log('STEP: save feedback and retry');
    await mini.evaluate(() => {
      const p=getCurrentPages().slice(-1)[0], id=getApp().__round2.id; p.editItem({detail:{id}});
      const placement=p.data.model.items[0]; p.placementChanged({detail:{placement:{...placement,x:placement.x+5}}});
    });
    assert.deepEqual(await state(),{guide:false,saved:true,error:'',learned:true});
    await mini.evaluate(() => {
      getApp().__round2.fail=true; const p=getCurrentPages().slice(-1)[0],placement=p.data.model.items[0];
      p.placementChanged({detail:{placement:{...placement,x:placement.x+5}}});
    });
    let status=await state(); assert.equal(status.saved,false); assert.ok(status.error);
    await mini.evaluate(()=>{getApp().__round2.fail=false;}); await act([],'retrySave');
    status=await state(); assert.equal(status.saved,true); assert.equal(status.error,'');
    await mini.reLaunch('/pages/index/index'); page=await mini.currentPage();
    await until(async()=>!(await page.data()).loading,'reopened journal');
    assert.equal((await state()).guide,false); checks.push('guide learned on arrangement; save failure stays visible and retry clears it; learned state survives reopening');
    await (await page.$('#record-today')).tap();
    await until(async()=>!!await page.$('#record-card'),'record card mount');
    console.log('STEP: record states');
    const card=await page.$('#record-card'), close=await card.$('#close-record');
    const closeColor=await close.style('background-color');
    assert.equal(parseFloat(await close.style('width')),44); assert.equal(await close.attribute('hover-class'),'ui-pressed');
    const task={state:'extracting',original:'/images/navigation/board-active.png'};
    await card.setData({task});
    const processing=await bounds(['#record-card','#record-photo'],['#task-preview','#cancel-photo']);
    await card.setData({task:{...task,state:'done',subject:'/images/navigation/today-active.png',kind:'extracted'}});
    const panel=await card.$('#record-photo');
    const done=await bounds(['#record-card','#record-photo'],['#task-preview','#continue-layout','#adjust-photo','#add-photo-note']);
    assert.ok(Math.abs(processing[0].height-done[0].height)<2,'State changes retain the preview and footer positions');
    assert.equal((await panel.$$('button.primary')).length,1);
    assert.ok(done[2].right<=done[3].left+1,'Secondary actions share one row');
    for(const r of done) assert.ok(r.width>0&&r.height>0&&r.bottom<=info.windowHeight+1);
    await mini.screenshot({path:path.join(output,'result-'+info.windowWidth+'.png')});
    await card.setData({task:{...task,state:'extractError',error:'提取未完成，请检查网络后重试。'.repeat(12)}});
    const failed=await bounds(['#record-card','#record-photo'],['#photo-error','#retry-extraction','#keep-original','#cancel-photo']);
    failed.forEach(r=>assert.ok(r&&r.height>0&&r.top>=0&&r.bottom<=info.windowHeight+1));
    checks.push('processing and done retain preview geometry; one primary next step; secondary actions paired; error retry remains reachable');
    await act([],'closeEditor'); await pause(250);
    await mini.evaluate(()=>getCurrentPages().slice(-1)[0].openMemory({detail:{id:getApp().__round2.id}}));
    await until(async()=>!!await page.$('#memory-card'),'memory card mount');
    const memory=await page.$('#memory-card'), memoryClose=await memory.$('#close-memory-card');
    assert.equal(await memoryClose.style('background-color'),closeColor);
    assert.equal(parseFloat(await memoryClose.style('width')),44);
    await act(['#memory-card'],'close'); await until(async()=>!await page.$('#memory-card'),'memory exit');
    await act([],'exportToday');
    await until(async()=>{const c=await page.$('#share-card');return c&&(await c.data()).imagePath;},'share preview');
    const shareClose=await (await page.$('#share-card')).$('#close-share-card');
    assert.equal(parseFloat(await shareClose.style('width')),44);
    await act(['#share-card'],'close'); await until(async()=>!await page.$('#share-card'),'share exit');
    checks.push('record, memory and share use the same 44px close targets and press feedback');
    assert.deepEqual(errors,[]);
  } finally {
    if(mini) {
      try {
      if(installed) {
        await mini.evaluate(()=>{
          for(const p of getCurrentPages()) {p.dirty=false;p.noteDirty=false;p.setData({editorOpen:false,memoryCardId:'',shareBoardId:'',boardDate:''});}
        }); await pause(250);
        await mini.evaluate(()=>{const q=getApp().__round2;if(q){Object.assign(require('core/store.js').getStore(),q.original);delete getApp().__round2;}});
        await mini.reLaunch('/pages/index/index');
      }
      if(backup)assert.deepEqual(await snapshot(),backup,'Original journal storage unchanged');
      } finally { mini.disconnect(); }
    }
  }
  fs.writeFileSync(path.join(output,'ui-'+info.windowWidth+'.json'),JSON.stringify({passed:true,info,checks,userStorageUnchanged:true},null,2));
  console.log('PASS:',checks.join('; '));
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
