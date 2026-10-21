// Native image decoding and layout with generated subjects; no user photos,
// network extraction, or persistent journal writes are used in this UI check.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const automator=require('miniprogram-automator'),{createCanvas}=require('@napi-rs/canvas');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const output=path.resolve('artifacts/photo-reveal');
const keys=['felt-journal:v1','felt-journal:drafts:v1','felt-journal:memory-drafts:v1','felt-journal:dev-extraction:v1','felt-journal:server-extraction:v1'];
(async()=>{
  let mini,backup,installed=false,files=[];const errors=[];
  const snapshot=()=>mini.evaluate(keys=>keys.map(key=>({key,exists:wx.getStorageInfoSync().keys.includes(key),value:wx.getStorageSync(key)})),keys);
  async function until(fn,label){for(let i=0;i<100;i++){if(await fn())return;await pause(50);}throw Error('Timed out: '+label);}
  try {
    mini=await automator.connect({wsEndpoint:process.env.WECHAT_AUTOMATION_URL||'ws://127.0.0.1:9420'});
    mini.on('exception',e=>errors.push(e));const info=await mini.systemInfo();assert.equal(info.platform,'devtools');
    await mini.evaluate(()=>{for(const p of getCurrentPages())if(p.dirty||p.photoTask||p.data.editorOpen||p.data.editable)throw Error('Finish editing first');});
    backup=await snapshot();fs.mkdirSync(output,{recursive:true});
    const subject=createCanvas(176,216),s=subject.getContext('2d');
    s.fillStyle='#FFF8E9';s.beginPath();s.ellipse(88,108,68,98,0,0,Math.PI*2);s.fill();
    s.fillStyle='#B87554';s.beginPath();s.ellipse(88,108,60,90,0,0,Math.PI*2);s.fill();
    const original=createCanvas(600,400),o=original.getContext('2d');o.fillStyle='#D6DDCA';o.fillRect(0,0,600,400);
    o.fillStyle='#B9A17F';o.fillRect(0,270,600,130);o.fillStyle='#B87554';o.beginPath();o.ellipse(400,170,60,90,0,0,Math.PI*2);o.fill();
    files=await mini.evaluate(images=>images.map((data,i)=>{const f=wx.env.USER_DATA_PATH+'/felt-reveal-'+Date.now()+'-'+i+'.png';wx.getFileSystemManager().writeFileSync(f,data,'base64');return f;}),[original.toBuffer('image/png').toString('base64'),subject.toBuffer('image/png').toString('base64')]);
    await mini.callWxMethod('switchTab',{url:'/pages/index/index'});
    await mini.evaluate(()=>{
      const module=require('core/store.js'),store=module.getStore(),disk={};getApp().__revealQA={original:{...store}};
      const isolated=module.createStore({get:k=>disk[k],set:(k,v)=>{disk[k]=v;}});isolated.commit(s=>{s.localNoticeSeen=true;});Object.assign(store,isolated);
      const p=getCurrentPages().slice(-1)[0];p.refresh();p.primary();
    });installed=true;
    const page=await mini.currentPage();await until(async()=>!!await page.$('#record-card'),'record card');const card=await page.$('#record-card');
    const task={id:'aligned',state:'uploading',original:files[0],previewOriginal:files[0]};
    await card.setData({task});const panel=await card.$('#record-photo');
    await until(async()=>await mini.evaluate(()=>!!getCurrentPages().slice(-1)[0].selectComponent('#record-card').selectComponent('#record-photo').photoReveal.originalInfo),'original decode');
    await pause(350);await mini.screenshot({path:path.join(output,'original.png')});
    await card.setData({task:{...task,state:'extracting'}});
    assert.equal((await panel.data()).originalSrc,files[0]);
    await mini.evaluate(()=>{
      const p=getCurrentPages().slice(-1)[0].selectComponent('#record-card').selectComponent('#record-photo'),q=getApp().__revealQA;q.trace=[];q.rects=[];
      const set=p.setData;p.setData=function(data,callback){if(data.revealPhase)q.trace.push({at:Date.now(),...data});return set.call(this,data,callback);};
      q.timer=setInterval(()=>{if(p.data.revealPhase==='fading')p.createSelectorQuery().select('#task-preview').boundingClientRect().select('#task-image').boundingClientRect().exec(r=>q.rects.push(r));},40);
    });
    const alignment={sourceWidth:600,sourceHeight:400,x:312,y:62,width:176,height:216};
    await card.setData({task:{...task,state:'done',subject:files[1],kind:'extracted',alignment}});
    await pause(240);await mini.screenshot({path:path.join(output,'fading.png')});
    await until(async()=>(await panel.data()).revealPhase==='ready','aligned reveal completes');
    await mini.screenshot({path:path.join(output,'ready.png')});
    const trace=await mini.evaluate(()=>{const q=getApp().__revealQA;clearInterval(q.timer);return {trace:q.trace,rects:q.rects};});
    assert.deepEqual(trace.trace.map(x=>x.revealPhase),['loading','aligned','fading','settling','ready']);
    assert.ok(trace.rects.length>1,'Collect native geometry during the actual fade');
    for(const [box,image] of trace.rects){const scale=Math.min(box.width/600,box.height/400);assert.ok(Math.abs(image.left-(box.left+(box.width-600*scale)/2+312*scale))<1);assert.ok(Math.abs(image.top-(box.top+(box.height-400*scale)/2+62*scale))<1);assert.ok(Math.abs(image.width-176*scale)<1);}
    assert.equal(String(await (await panel.$('#continue-layout')).attribute('disabled')),'false');
    await (await panel.$('#compare-photo')).tap();await until(async()=>(await panel.data()).showOriginal,'original comparison');
    await (await panel.$('#compare-photo')).tap();await until(async()=>!(await panel.data()).showOriginal,'subject comparison');
    await card.setData({task:{...task,id:'legacy',state:'extracting'}});await pause(100);
    await card.setData({task:{...task,id:'legacy',state:'done',subject:files[1],kind:'extracted'}});
    await until(async()=>(await panel.data()).revealPhase==='ready','legacy fallback');
    await card.setData({task:{...task,id:'cancelled',state:'extracting'}});
    await card.setData({task:{...task,id:'cancelled',state:'done',subject:files[1],kind:'extracted',alignment}});
    await page.callMethod('closeEditor');await pause(1000);assert.equal((await page.data()).placing,null);
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(output,'verification.json'),JSON.stringify({passed:true,width:info.windowWidth,userStorageUnchanged:true,...trace},null,2));
    console.log('PASS: native decode, aligned 520ms fade, stable subject geometry, final fit, comparison, legacy fallback and mid-reveal close');
  } finally {
    if(mini){try{
      if(installed){await mini.evaluate(()=>{const q=getApp().__revealQA;if(q)clearInterval(q.timer);const p=getCurrentPages().slice(-1)[0];p.setData({editorOpen:false});});await pause(250);await mini.evaluate(()=>{const q=getApp().__revealQA;if(q){Object.assign(require('core/store.js').getStore(),q.original);delete getApp().__revealQA;}getCurrentPages().forEach(p=>p.refresh&&p.refresh());});}
      for(const f of files)await mini.evaluate(f=>{try{wx.getFileSystemManager().unlinkSync(f);}catch(_){}},f);
      if(backup)assert.deepEqual(await snapshot(),backup,'User storage unchanged');
    }finally{mini.disconnect();}}
  }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
