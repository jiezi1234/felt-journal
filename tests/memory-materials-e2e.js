// Native material acceptance uses generated art and an isolated in-memory store.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { createCanvas } = require('@napi-rs/canvas');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve('artifacts/memory-materials');
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1', 'felt-journal:dev-extraction:v1', 'felt-journal:server-extraction:v1'];
(async () => {
  let mini, before, file, installed = false, completed = false;
  const checks = [], errors = [], layouts = [];
  const snapshot = () => mini.evaluate(names => names.map(key => ({ key, exists:wx.getStorageInfoSync().keys.includes(key), value:wx.getStorageSync(key) })), keys);
  const act = (method, arg) => mini.evaluate((method, arg) => getCurrentPages().slice(-1)[0].selectComponent('#memory-card')[method](arg), method, arg);
  const data = () => mini.evaluate(() => { const c = getCurrentPages().slice(-1)[0].selectComponent('#memory-card'); return c && { style:c.data.cardStyle, phase:c.data.pickupPhase, busy:c.data.pickupBusy, editing:c.data.editing, flipped:c.data.flipped, caption:c.data.frontCaption }; });
  async function until(fn, label) { for (let n=0; n<100; n++) { const result=await fn(); if(result)return result; await pause(80); } throw Error('Timed out: '+label); }
  async function layout(label, selectors) {
    await pause(480);
    const measured = await mini.evaluate(selectors => new Promise(resolve => {
      const c = getCurrentPages().slice(-1)[0].selectComponent('#memory-card'), q=c.createSelectorQuery();
      selectors.forEach(s=>q.select(s).boundingClientRect());
      q.exec(rects=>resolve({rects,height:c.data.modalHeight,width:wx.getSystemInfoSync().windowWidth}));
    }), selectors);
    measured.rects.forEach((r,i)=>assert.ok(r && r.width>0 && r.height>0 && r.left>=-1 && r.right<=measured.width+1 && r.top>=-1 && r.bottom<=measured.height+1,label+' '+selectors[i]+': '+JSON.stringify(measured)));
    if(label.endsWith(' front')) {
      assert.ok(measured.rects[2].bottom<=measured.rects[4].top+1,'image frame and caption do not overlap');
      assert.ok(measured.rects[4].bottom<=measured.rects[5].top+1,'caption and footer do not overlap');
    }
    if(label.endsWith(' back')) assert.ok(measured.rects[1].bottom<=measured.rects[2].top+1,'note and footer do not overlap');
    layouts.push({label,selectors,...measured}); checks.push(label);
  }
  async function capture(label) { console.log('CHECK:',label); if(process.env.MATERIAL_SCREENSHOTS === '1') await mini.screenshot({path:path.join(output,label+'.png')}); }
  try {
    mini=await automator.connect({wsEndpoint:process.env.WECHAT_AUTOMATION_URL||'ws://127.0.0.1:9420'});
    await until(()=>mini.evaluate(()=>!!getApp()&&getCurrentPages().length>0),'app startup');
    mini.on('exception',e=>errors.push(e)); before=await snapshot(); fs.mkdirSync(output,{recursive:true});
    await mini.evaluate(()=>{if(wx.getSystemInfoSync().platform!=='devtools')throw Error('Simulator only');for(const p of getCurrentPages())if(p.dirty||p.photoTask||p.data.memoryCardId||p.data.editorOpen)throw Error('Finish editing first');});
    const art=createCanvas(520,440),ctx=art.getContext('2d');
    ctx.shadowColor='#49372755';ctx.shadowBlur=16;ctx.shadowOffsetY=10;
    const saucer=ctx.createRadialGradient(230,190,50,260,220,180);saucer.addColorStop(0,'#D6CBB4');saucer.addColorStop(.73,'#FFFAE7');saucer.addColorStop(.85,'#BAAE94');saucer.addColorStop(.9,'#FFF8E5');saucer.addColorStop(1,'#D7CAB1');
    ctx.fillStyle=saucer;ctx.beginPath();ctx.ellipse(260,220,180,174,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#EAE1C9';ctx.lineWidth=24;ctx.beginPath();ctx.ellipse(387,210,38,40,0,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#F8EFDA';ctx.beginPath();ctx.arc(252,204,127,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    const coffee=ctx.createRadialGradient(230,190,12,252,204,114);coffee.addColorStop(0,'#D7AA6A');coffee.addColorStop(.8,'#B98243');coffee.addColorStop(1,'#87522C');
    ctx.fillStyle=coffee;ctx.beginPath();ctx.arc(252,204,112,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#FFF0CD';ctx.beginPath();ctx.moveTo(251,248);ctx.bezierCurveTo(160,201,206,162,251,194);ctx.bezierCurveTo(300,162,338,209,251,248);ctx.fill();
    file=await mini.evaluate(bytes=>{const p=wx.env.USER_DATA_PATH+'/felt-material-'+Date.now()+'.png';wx.getFileSystemManager().writeFileSync(p,bytes,'base64');wx.getFileSystemManager().writeFileSync(p+'.original.png',bytes,'base64');return p;},art.toBuffer('image/png').toString('base64'));
    await mini.callWxMethod('switchTab',{url:'/pages/index/index'});await pause(300);
    await mini.evaluate(file=>{
      const module=require('core/store.js'),store=module.getStore(),disk={},original={...store};
      const isolated=module.createStore({get:key=>disk[key],set:(key,value)=>{disk[key]=value;}}),date=require('core/date.js').key();
      const id=isolated.add('materials',date,{originalPath:file+'.original.png',subjectPath:file,width:520,height:440,kind:'extracted'});
      isolated.edit(id,'忙里偷来的十分钟。\n窗边的光落在杯沿，咖啡还是温的。\n\n没发生什么特别的事，\n但这一刻，想留住。','饮食');
      isolated.createTheme('materials','日常小记');isolated.commit(s=>{s.localNoticeSeen=true;s.boardGuideSeen=true;});
      getApp().__materials={original,id,random:Math.random};Object.assign(store,isolated);
      const p=getCurrentPages().slice(-1)[0];p.setData({editable:false,selected:''});p.refresh();
    },file);installed=true;
    await pause(400);
    for(const [style,random] of [['cotton',.1],['polaroid',.5],['ticket',.9]]) {
      const raw=await mini.evaluate(()=>JSON.stringify(require('core/store.js').getStore().get()));
      await mini.evaluate(value=>{Math.random=()=>value;getCurrentPages().slice(-1)[0].openMemory({detail:{id:getApp().__materials.id}});},random);
      const opened=await until(async()=>{const d=await data();return d&&!d.busy&&d;},style+' open');
      await mini.evaluate(()=>{Math.random=getApp().__materials.random;});
      assert.equal(opened.style,style);assert.equal(opened.phase,'open');
      const nativeCard=await (await mini.currentPage()).$('#memory-card'),paper=await nativeCard.$('#pickup-paper');
      await until(async()=>await paper.style('opacity')==='1'&&await paper.style('transform')==='matrix(1, 0, 0, 1, 0, 0)',style+' native paper settled');
      const face=await nativeCard.$('.card-front');
      assert.equal(await face.style('background-color'),{cotton:'rgb(248, 244, 233)',polaroid:'rgb(250, 249, 244)',ticket:'rgb(237, 227, 201)'}[style],'native material palette applied');
      assert.equal(await mini.evaluate(()=>JSON.stringify(require('core/store.js').getStore().get())),raw,'opening is read-only');
      await layout(style+' front',['#pickup-paper','.card-front','.card-photo-well','#card-photo','.card-caption','.card-front-footer']);
      await capture(style+'-front');
      await act('flip');
      const turn=await nativeCard.$('#flip-card');
      await until(async()=>(await turn.style('transform')).startsWith('matrix3d(-1,'),style+' native back settled');
      await layout(style+' back',['.card-back','.card-note-zone','.card-note-meta','#edit-card-note','#add-to-theme']);await capture(style+'-back');
      await act('edit');await layout(style+' editor',['#card-note-input','#cancel-card-note','#save-card-note']);await capture(style+'-editor');
      await act('input',{detail:{value:'长文字也能完整保存。\n'.repeat(60)}});
      await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#memory-card').modalPresentation.keyboardChanged({height:470}));
      await layout(style+' keyboard',['.memory-card-dialog','#close-memory-card','#card-note-input','#save-card-note']);
      await mini.evaluate(()=>getCurrentPages().slice(-1)[0].selectComponent('#memory-card').modalPresentation.keyboardChanged({height:0}));
      await act('save');assert.equal((await data()).style,style);assert.equal((await data()).caption,'长文字也能完整保存。');
      await layout(style+' long reading',['.card-note-reading','.card-note-meta','#edit-card-note']);
      await act('edit');await act('input',{detail:{value:'取消这段文字'}});await act('cancelEdit');assert.equal((await data()).caption,'长文字也能完整保存。');
      await act('openThemes');await layout(style+' themes',['#card-theme-picker','#close-card-themes','#new-card-theme']);
      await act('close');assert.ok(await data(),'first close only dismisses themes');
      await act('edit');await act('input',{detail:{value:''}});await act('save');
      assert.equal((await data()).caption,'把平凡的一刻，轻轻收好');
      await layout(style+' empty note',['.card-empty','#edit-card-note']);
      await act('close');await until(async()=>!await data(),style+' return');
      await mini.evaluate(()=>{const q=getApp().__materials,s=require('core/store.js').getStore();s.edit(q.id,'忙里偷来的十分钟。\n窗边的光落在杯沿，咖啡还是温的。\n\n没发生什么特别的事，\n但这一刻，想留住。','饮食');});
      console.log('PASS:',style,'front/back/editor, long notes, keyboard, themes and pickup return');
    }
    assert.deepEqual(errors,[]);completed=true;
  } finally {
    if(mini) {
      if(installed) {
        await mini.evaluate(()=>{const q=getApp().__materials;if(!q)return;Math.random=q.random;for(const p of getCurrentPages()){const c=p.selectComponent('#memory-card');if(c)c.dirty=false;p.setData({memoryCardId:'',memoryCardSource:null,editable:false,selected:''});}});
        await pause(250);
        await mini.evaluate(()=>{const q=getApp().__materials;Object.assign(require('core/store.js').getStore(),q.original);delete getApp().__materials;getCurrentPages().forEach(p=>{if(p.refresh)p.refresh();});if(wx.disableAlertBeforeUnload)wx.disableAlertBeforeUnload({});});
      }
      if(file)await mini.evaluate(file=>{for(const p of [file,file+'.original.png'])try{wx.getFileSystemManager().unlinkSync(p);}catch(_){}},file);
      if(before)assert.deepEqual(await snapshot(),before,'user storage unchanged');
      const info=await mini.systemInfo();mini.disconnect();
      fs.writeFileSync(path.join(output,'acceptance.json'),JSON.stringify({passed:completed,checks,layouts,errors,info,userStorageUnchanged:true,keyboard:'Simulated keyboard-height events'},null,2));
    }
  }
  console.log('PASS:',checks.length,'material layout checks; user storage unchanged');
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
