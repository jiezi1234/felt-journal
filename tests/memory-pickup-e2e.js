// Native animation acceptance with generated shapes and an in-memory journal.
// Stored records/photos and extraction settings are never replaced.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { createCanvas } = require('@napi-rs/canvas');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve('artifacts/memory-pickup');
(async () => {
  let mini, before, installed = false, files = [], completed = false;
  const checks = [], traces = [], handoffs = [], errors = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists:wx.getStorageInfoSync().keys.includes(key), value:wx.getStorageSync(key) })), keys);
  const act = (chain, method, arg) => mini.evaluate((chain, method, arg) => {
    const host = chain.reduce((p, s) => p.selectComponent(s), getCurrentPages().slice(-1)[0]);
    return host[method](arg);
  }, chain, method, arg);
  const state = chain => mini.evaluate(chain => {
    const host = chain.reduce((p, s) => p.selectComponent(s), getCurrentPages().slice(-1)[0]);
    const c = host && host.selectComponent('#memory-card'), b = host && (host.selectComponent('#today-board') || host.selectComponent('#board'));
    return { card:!!c, id:host && host.data.memoryCardId, phase:c && c.data.pickupPhase, enabled:c && c.data.pickupEnabled,
      busy:c && c.data.pickupBusy, flipBusy:c && c.data.flipBusy, flipped:c && c.data.flipped, editing:c && c.data.editing,
      source:c && c.data.source, from:c && c.pickup.from, bounds:c && c.pickup.bounds, hidden:b && b.pickupId,
      covered:b && b.data.covered, paper:c && c.data.pickupPaperAnimation, modalHeight:c&&c.data.modalHeight };
  }, chain);
  async function until(fn, label) { for (let i = 0; i < 100; i++) { const value = await fn(); if (value) return value; await pause(70); } throw Error('Timed out: ' + label); }
  async function startHandoff(chain) {
    await mini.evaluate(chain=>{
      const q=getApp().__pickupAcceptance;q.handoffFrames=[];q.handoffStart=Date.now();
      q.handoffTimer=setInterval(()=>{
        const h=chain.reduce((p,s)=>p.selectComponent(s),getCurrentPages().slice(-1)[0]),b=h&&(h.selectComponent('#today-board')||h.selectComponent('#board'));
        if(!b||b.dead)return;
        const c=h.selectComponent('#memory-card'),d=b.data,phase={covered:d.covered,hidden:d.canvasHidden,raster:d.snapshotVisible,path:d.snapshot,slot:d.snapshotSlot,
          cardPhase:c&&c.data.pickupPhase,preloaded:b.pickupReturn&&b.pickupReturn.snapshot&&b.pickupReturn.snapshot.path};
        b.createSelectorQuery().select('#feltCanvas').boundingClientRect()
          .selectAll('.board-snapshot').boundingClientRect().exec(([canvas,images])=>{
            q.handoffFrames.push({ms:Date.now()-q.handoffStart,...phase,canvas,images});
          });
      },16);
    },chain);
  }
  async function finishHandoff(label) {
    await pause(100);
    const frames=await mini.evaluate(()=>{const q=getApp().__pickupAcceptance;clearInterval(q.handoffTimer);return q.handoffFrames;});
    assert.ok(frames.length>5,label+' samples the transition');
    for(const f of frames) {
      const canvas=f.canvas&&f.canvas.width>0&&f.canvas.height>0;
      const raster=f.raster&&(f.images||[]).some(image=>image.dataset.path===f.path&&image.dataset.slot===f.slot&&image.width>0&&image.height>0);
      assert.ok(canvas||raster,label+' must always retain a visible board layer: '+JSON.stringify(f));
      if(f.preloaded&&f.cardPhase!=='landed')assert.notEqual(f.path,f.preloaded,label+' keeps the restored object hidden until landing');
    }
    handoffs.push({label,frames});checks.push(label+' retains a visible board throughout');
  }
  async function open(chain, id, label) {
    await until(() => mini.evaluate(chain => {
      const h = chain.reduce((p, s) => p.selectComponent(s), getCurrentPages().slice(-1)[0]);
      const b = h && (h.selectComponent('#today-board') || h.selectComponent('#board'));
      return b && b.displayModel && b.displayModel.items.length && b.images && !b.data.covered;
    }, chain), label + ' board ready');
    const stored = await mini.evaluate(() => JSON.stringify(require('core/store.js').getStore().get()));
    const touch = await mini.evaluate((chain, id) => new Promise(resolve => {
      const h = chain.reduce((p, s) => p.selectComponent(s), getCurrentPages().slice(-1)[0]);
      const b = h.selectComponent('#today-board') || h.selectComponent('#board');
      b.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
        const item = b.displayModel.items.find(p => p.memoryId === id);
        resolve({ identifier:0, clientX:rect.left+(item.x+45)*b.screenWidth/1500, clientY:rect.top+(item.y+45)*b.screenWidth/1500 });
      }).exec();
    }), chain, id);
    let owner = await mini.currentPage(); for (const selector of chain) owner = await owner.$(selector);
    const board = await owner.$('#today-board') || await owner.$('#board');
    const canvas = await board.$('#feltCanvas');
    await startHandoff(chain);
    // Arm sampling before dispatch; a fast renderer can finish while the
    // automation bridge is still returning the touch/mount acknowledgements.
    await mini.evaluate(chain => {
      const q = getApp().__pickupAcceptance; q.frames = []; q.started = Date.now();
      q.sample = setInterval(() => {
        const h = chain.reduce((p, s) => p.selectComponent(s), getCurrentPages().slice(-1)[0]), c = h && h.selectComponent('#memory-card');
        if (!c || c.dead) return;
        c.createSelectorQuery().select('#pickup-photo').boundingClientRect().select('#card-photo').boundingClientRect().exec(rects => {
          q.frames.push({ ms:Date.now()-q.started, phase:c.data.pickupPhase, rects });
        });
      }, 45);
    }, chain);
    await canvas.touchstart({ touches:[touch], changedTouches:[touch] });
    await pause(50); await canvas.touchend({ touches:[], changedTouches:[touch] });
    console.log('STEP:',label,'touch dispatched');
    await until(async () => (await state(chain)).card, label + ' mounted');
    const opened = await until(async () => { const s = await state(chain); if (s.card && !s.busy) return s; }, label + ' animation complete');
    assert.equal(opened.enabled, true, label + ' uses pickup instead of fallback: ' + JSON.stringify(opened));
    assert.equal(opened.phase, 'open'); assert.equal(opened.hidden, id); assert.equal(opened.covered, true);
    assert.ok(Math.abs(opened.from.angle) <= 180, 'short rotation');
    assert.equal(await mini.evaluate(() => JSON.stringify(require('core/store.js').getStore().get())), stored, label + ' opening is read-only');
    const card = await owner.$('#memory-card'), paper = await card.$('#pickup-paper');
    await until(async()=>await paper.style('opacity')==='1'&&await paper.style('transform')==='none',label+' native paper settled');
    await pause(80);
    const frames = await mini.evaluate(() => { const q=getApp().__pickupAcceptance; clearInterval(q.sample); return q.frames; });
    assert.ok(frames.some(f => f.rects[0] && f.rects[0].width > 0), label + ' native photo renders');
    const positions = new Set(frames.filter(f => f.rects[0]).map(f => Math.round(f.rects[0].left)+','+Math.round(f.rects[0].width)));
    assert.ok(positions.size > 1, label + ' native photo actually moves');
    assert.equal(await paper.style('opacity'),'1',label + ' paper is visible');
    const final = frames.at(-1).rects[1];
    const paperBounds = opened.bounds.paper, target = opened.bounds.target;
    assert.ok(final.left >= paperBounds.left && final.right <= paperBounds.right && final.top >= paperBounds.top && final.bottom <= paperBounds.bottom,
      label + ' image stays inside its material frame: '+JSON.stringify(final));
    assert.ok(Math.abs(final.left+final.width/2-target.left-target.width/2)<2 && Math.abs(final.top+final.height/2-target.top-target.height/2)<2,
      label + ' pickup finishes at the fully expanded image center');
    traces.push({ label, opened, frames }); checks.push(label + ' touch opens from actual placement');
    await finishHandoff(label+' opening');
    console.log('PASS:', label, 'open', opened.source.rect, 'frames', positions.size);
  }
  async function close(chain, back, label, keyboard = false) {
    const opened=await state(chain);
    if (back) { await act([...chain,'#memory-card'], 'flip'); await until(async()=>!(await state(chain)).flipBusy,label+' back settled'); }
    if(keyboard) {
      await act([...chain,'#memory-card'],'edit');await act([...chain,'#memory-card'],'input',{detail:{value:'键盘关闭时保留这段记录。'}});
      await mini.evaluate(chain=>{
        const h=chain.reduce((p,s)=>p.selectComponent(s),getCurrentPages().slice(-1)[0]),c=h.selectComponent('#memory-card');
        c.modalPresentation.keyboardChanged({height:260});
      },chain);await pause(100);
    }
    const exitHeight=(await state(chain)).modalHeight;
    const closingFace=(await state(chain)).flipped;
    await startHandoff(chain);
    await act([...chain,'#memory-card'], 'close');
    if(keyboard)await mini.evaluate(chain=>{
      const h=chain.reduce((p,s)=>p.selectComponent(s),getCurrentPages().slice(-1)[0]),c=h.selectComponent('#memory-card');
      c.modalPresentation.keyboardChanged({height:0});
    },chain);
    const closing = await state(chain); assert.equal(closing.busy, true);
    await act([...chain,'#memory-card'], 'close'); // A second tap must not duplicate cleanup.
    const returning=await until(async()=>{const s=await state(chain);return s.phase==='returning'&&s;},label+' return animation');
    assert.equal(returning.flipped,closingFace,'closing collapses the current face without waiting for another turn');
    if(keyboard)assert.equal(returning.modalHeight,exitHeight,'keyboard dismissal does not resize the card during return');
    else assert.ok(Math.abs(returning.bounds.target.width-opened.bounds.target.width)<1,label+' measures the fully front-facing image');
    await until(async () => !(await state(chain)).card, label + ' return');
    const restored = await state(chain); assert.ok(!restored.hidden); assert.equal(restored.covered, false);
    await until(()=>mini.evaluate(chain=>{const h=chain.reduce((p,s)=>p.selectComponent(s),getCurrentPages().slice(-1)[0]),b=h.selectComponent('#today-board')||h.selectComponent('#board');return !b.data.canvasHidden&&!b.data.snapshotVisible;},chain),label+' live canvas ready');
    await finishHandoff(label+' closing');
    const home=await mini.evaluate((chain,id)=>{
      const h=chain.reduce((p,s)=>p.selectComponent(s),getCurrentPages().slice(-1)[0]);
      return (h.selectComponent('#today-board')||h.selectComponent('#board')).pickupRect(id);
    },chain,opened.id);
    const target=returning.bounds.target, pose=returning.from;
    assert.ok(Math.abs(target.left+target.width/2+pose.x-home.left-home.width/2)<1,label+' restores horizontal position');
    assert.ok(Math.abs(target.top+target.height/2+pose.y-home.top-home.height/2)<1,label+' restores vertical position');
    assert.ok(Math.abs(target.width*pose.scale-home.width)<1,label+' restores original size');
    checks.push(label + ' closes and restores board'); console.log('PASS:', label, 'return');
  }
  try {
    mini = await automator.connect({ wsEndpoint:process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    await until(()=>mini.evaluate(()=>!!getApp()&&getCurrentPages().length>0),'app startup');
    mini.on('exception', e => errors.push(e)); fs.mkdirSync(output, { recursive:true }); before = await snapshot(); console.log('STEP: connected');
    await mini.evaluate(() => {
      if (wx.getSystemInfoSync().platform !== 'devtools') throw Error('Simulator only');
      for (const p of getCurrentPages()) if (p.dirty || p.noteDirty || p.photoTask || p.data.editorOpen || p.data.memoryCardId || p.data.shareBoardId || p.data.boardDate) throw Error('Finish editing first');
    });
    const images = [[600,240,'#C98546'],[240,600,'#71936D']].map(([w,h,color]) => {
      const canvas=createCanvas(w,h), ctx=canvas.getContext('2d'); ctx.fillStyle=color; ctx.beginPath(); ctx.ellipse(w/2,h/2,w*.43,h*.43,0,0,Math.PI*2); ctx.fill();
      ctx.fillStyle='#FAE2B5'; ctx.beginPath(); ctx.arc(w*.45,h*.38,Math.min(w,h)*.13,0,Math.PI*2); ctx.fill();
      return canvas.toBuffer('image/png').toString('base64');
    });
    files = await mini.evaluate(images => images.map((bytes,i) => {
      const file=wx.env.USER_DATA_PATH+'/felt-pickup-'+Date.now()+'-'+i+'.png'; wx.getFileSystemManager().writeFileSync(file,bytes,'base64'); return file;
    }), [...images,...images]);
    await mini.callWxMethod('switchTab',{url:'/pages/index/index'}); await pause(250); installed = true;
    const fixture = await mini.evaluate(files => {
      const module=require('core/store.js'), store=module.getStore(), original={...store}, disk={};
      const isolated=module.createStore({get:key=>disk[key],set:(key,value)=>{disk[key]=value;}}), date=require('core/date.js').key();
      const wide=isolated.add('pickup-wide',date,{originalPath:files[2],subjectPath:files[0],width:600,height:240,kind:'extracted'});
      const tall=isolated.add('pickup-tall',date,{originalPath:files[3],subjectPath:files[1],width:240,height:600,kind:'extracted'});
      const theme=isolated.createTheme('pickup','拾起展开验收',wide); isolated.place(tall,theme);
      isolated.commit(s=>{s.localNoticeSeen=true;s.boardGuideSeen=true;for(const board of Object.values(s.boards)) board.placements.forEach((p,i)=>Object.assign(p,{x:i?1050:380,y:i?580:300,width:i?260:460,height:i?550:240,angle:i?27:348}));});
      getApp().__pickupAcceptance={original,wide,tall,date,theme}; Object.assign(store,isolated);
      const p=getCurrentPages().slice(-1)[0]; p.history=null; p.checkedDraft=false; p.setData({editable:false,selected:''});p.refresh();
      return {wide,tall,date,theme};
    }, files); console.log('STEP: isolated fixtures ready');
    if(process.env.PICKUP_SLOW_SNAPSHOT==='1')await mini.evaluate(()=>{
      const module=require('services/board-snapshot.js'),q=getApp().__pickupAcceptance;q.originalLoaded=module.loaded;
      module.loaded=(host,event)=>setTimeout(()=>q.originalLoaded(host,event),180);
    });
    await open([],fixture.wide,'today wide tilted');
    if (process.env.PICKUP_REVIEW_MS) await pause(Number(process.env.PICKUP_REVIEW_MS));
    await act(['#memory-card'],'flip'); await pause(80); await act(['#memory-card'],'flip');
    await close([],false,'today front');
    await act([],'openMemory',{detail:{id:fixture.wide}});
    await until(async()=>(await state([])).phase==='opening','interruptible entrance');
    await act(['#memory-card'],'pickupFailed');
    await until(async()=>{const s=await state([]);return s.card&&!s.enabled&&!s.busy&&!s.hidden;},'failure restores original');
    await pause(300);
    const fallbackPaper=await (await (await mini.currentPage()).$('#memory-card')).$('#pickup-paper');
    await until(async()=>await fallbackPaper.style('opacity')==='1'&&await fallbackPaper.style('transform')==='none',
      'interrupted paper becomes fully visible at its original size');
    await act(['#memory-card'],'close'); await until(async()=>!(await state([])).card,'fallback closes');
    checks.push('interrupted native entrance restores full-size usable card and source');
    await open([],fixture.tall,'today tall tilted');
    await act(['#memory-card'],'flip'); await until(async()=>!(await state([])).flipBusy,'back ready for editing'); await act(['#memory-card'],'edit');
    await act(['#memory-card'],'input',{detail:{value:'拾起展开后编辑文字。'}});
    await act(['#memory-card'],'save');
    assert.equal(await mini.evaluate(id=>require('core/store.js').getStore().get().memories[id].text,fixture.tall),'拾起展开后编辑文字。');
    await act(['#memory-card'],'openThemes'); await act(['#memory-card'],'close');
    assert.equal((await state([])).card,true,'first close dismisses theme picker');
    await close([],false,'today edited back');
    await open([],fixture.tall,'today keyboard');await close([],true,'today keyboard close',true);
    assert.equal(await mini.evaluate(id=>require('core/store.js').getStore().get().memories[id].text,fixture.tall),'键盘关闭时保留这段记录。');
    checks.push('closing an active note saves its text and preserves exit geometry');
    await mini.callWxMethod('switchTab',{url:'/pages/board-tab/index'}); await pause(250);
    await open([],fixture.wide,'theme'); await close([],true,'theme back');
    await mini.callWxMethod('navigateTo',{url:'/pages/board/index?date='+fixture.date}); await pause(250);
    await open([],fixture.tall,'board page'); await close([],false,'board page');
    await mini.callWxMethod('navigateBack',{});
    await mini.callWxMethod('switchTab',{url:'/pages/calendar/index'}); await pause(200);
    await act([],'open',{currentTarget:{dataset:{date:fixture.date}}}); await pause(350);
    await open(['#day-board-card'],fixture.wide,'nested date board'); await close(['#day-board-card'],true,'nested date board');
    assert.equal((await (await mini.currentPage()).data()).boardDate,fixture.date,'outer date card retained');
    await act(['#day-board-card'],'close');
    await until(async()=>!(await (await mini.currentPage()).data()).boardDate,'outer date exit');
    assert.deepEqual(errors,[]); completed=true;
  } finally {
    if (mini) {
      if(installed) await mini.evaluate(()=>{
        const app=getApp(),q=app&&app.__pickupAcceptance;if(!q)return;clearInterval(q.sample);clearInterval(q.handoffTimer);
        if(q.originalLoaded)require('services/board-snapshot.js').loaded=q.originalLoaded;
        for(const p of getCurrentPages()) { for(const selector of ['#memory-card','#day-board-card']) {const c=p.selectComponent(selector);if(c){c.dirty=false;c.noteDirty=false;}}
          p.dirty=false;p.noteDirty=false;p.setData({editable:false,selected:'',memoryCardId:'',memoryCardSource:null,boardDate:''}); }
      });
      await pause(250);
      if(installed) await mini.evaluate(()=>{const app=getApp(),q=app&&app.__pickupAcceptance;if(!q)return;Object.assign(require('core/store.js').getStore(),q.original);delete app.__pickupAcceptance;
        getCurrentPages().forEach(p=>{p.history=null;if(p.refresh)p.refresh();});if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload({});});
      for(const file of files) await mini.evaluate(file=>{try{wx.getFileSystemManager().unlinkSync(file);}catch(_){}},file);
      if(before) assert.deepEqual(await snapshot(),before,'user storage unchanged');
      await mini.callWxMethod('switchTab',{url:'/pages/index/index'}); const info=await mini.systemInfo(); mini.disconnect();
      fs.writeFileSync(path.join(output,'acceptance-'+info.windowWidth+'.json'),JSON.stringify({passed:completed,info,checks,traces,handoffs,errors,slowDecode:process.env.PICKUP_SLOW_SNAPSHOT==='1',userStorageUnchanged:true},null,2));
    }
  }
  console.log('PASS:',checks.length,'pickup checks; user storage unchanged');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
