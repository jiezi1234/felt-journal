const test=require('node:test');
const assert=require('node:assert/strict');
const geometry=require('../miniprogram/core/photo-reveal');
const reveal=require('../miniprogram/services/photo-reveal');
let definition;global.Component=value=>{definition=value;};require('../miniprogram/components/photo-panel/index');delete global.Component;
const alignment={sourceWidth:1000,sourceHeight:600,x:200,y:100,width:300,height:300};
function fixture(t) {
  t.mock.timers.enable({apis:['setTimeout']});
  const p={...definition.methods,data:{...definition.data},events:[],
    setData(data,done){Object.assign(this.data,data);if(done)done();},
    createSelectorQuery(){return {select(){return this;},boundingClientRect(fn){this.callback=fn;return this;},exec(){this.callback({width:320,height:260});}};},
    triggerEvent(name){this.events.push(name);}
  };
  const update=task=>{p.data.task=task;definition.observers.task.call(p,task);};
  const load=(kind,src,width,height)=>reveal.loaded(p,kind,{currentTarget:{dataset:{src}},detail:{width,height}});
  t.after(()=>{p.dead=true;reveal.clear(p);});
  return {p,update,load,task:{id:'one',state:'uploading',original:'/saved-original',previewOriginal:'/chosen-original'}};
}
test('source crop coordinates preserve an off-center subject before fitting the final preview',()=>{
  const result=geometry.frames(alignment,{width:2000,height:1200},{width:300,height:300},{width:320,height:260});
  assert.deepEqual(result.aligned,{left:64,top:66,width:96,height:96});
  assert.ok(Math.abs(result.final.width-239.2)<.001);
  const negative=geometry.frames({...alignment,x:-10,y:-5},{width:1000,height:600},{width:300,height:300},{width:320,height:260});
  assert.equal(negative.aligned.left,-3.2);
  assert.match(geometry.style(result.aligned,{width:320,height:260}),/^left:20%;/);
  for(const bad of [null,{...alignment,x:Infinity},{...alignment,width:-1},{...alignment,x:5000}]) assert.equal(geometry.alignment(bad),null);
  assert.equal(geometry.frames(alignment,{width:600,height:1000},{width:300,height:300},{width:320,height:260}),null);
  assert.equal(geometry.frames(alignment,{width:1000,height:600},{width:500,height:100},{width:320,height:260}),null);
});
test('waits for decoding, reveals at the original coordinates, then settles once before enabling continue',t=>{
  const {p,update,load,task}=fixture(t);update(task);load('original','/chosen-original',1000,600);
  update({...task,state:'saving',subject:'/temporary-cutout',kind:'extracted',alignment});
  assert.equal(p.data.subjectSrc,'');assert.equal(p.data.originalSrc,'/chosen-original');
  update({...task,state:'done',subject:'/saved-cutout',kind:'extracted',alignment});
  p.continueLayout();assert.deepEqual(p.events,[]);assert.equal(p.data.originalHidden,false);
  t.mock.timers.tick(2000);assert.equal(p.data.revealPhase,'loading');
  load('subject','/temporary-cutout',300,300);assert.equal(p.data.revealPhase,'loading');
  load('subject','/saved-cutout',300,300);assert.equal(p.data.revealPhase,'aligned');assert.match(p.data.subjectStyle,/left:20%;/);
  t.mock.timers.tick(32);assert.equal(p.data.revealPhase,'fading');assert.equal(p.data.originalHidden,true);
  t.mock.timers.tick(520);assert.equal(p.data.revealPhase,'settling');assert.equal(p.data.revealBusy,true);
  t.mock.timers.tick(260);assert.equal(p.data.revealPhase,'ready');assert.equal(p.data.revealBusy,false);
  update({...p.data.task});assert.equal(p.data.revealPhase,'ready','Repeated state notifications do not replay');
});
test('legacy response fades through neutral instead of overlapping incompatible crops',t=>{
  const {p,update,load,task}=fixture(t);update(task);load('original','/chosen-original',1000,600);
  update({...task,state:'done',subject:'/cutout',kind:'extracted'});load('subject','/cutout',300,300);
  assert.equal(p.data.revealPhase,'fallback-hide');assert.equal(p.data.subjectVisible,false);
  t.mock.timers.tick(160);assert.equal(p.data.revealPhase,'fallback-show');assert.equal(p.data.subjectVisible,true);
  t.mock.timers.tick(180);assert.equal(p.data.revealBusy,false);
});
test('a failed preview retains the original, retries only preview and ignores old task callbacks',t=>{
  const {p,update,load,task}=fixture(t);update(task);load('original','/chosen-original',1000,600);
  update({...task,state:'done',subject:'/cutout',kind:'extracted',alignment});
  t.mock.timers.tick(7000);assert.ok(p.data.revealError);assert.equal(p.data.originalHidden,false);
  p.continueLayout();assert.deepEqual(p.events,[]);
  p.retryPreview();load('subject','/cutout',300,300);assert.equal(p.data.revealPhase,'aligned');
  update({...task,id:'two',original:'/second',previewOriginal:'/second',state:'uploading'});
  load('subject','/cutout',300,300);t.mock.timers.tick(2000);
  assert.equal(p.data.revealPhase,'original');assert.equal(p.data.subjectSrc,'');assert.deepEqual(p.events,[]);
});
test('detaching during reveal cancels all completion callbacks',t=>{
  const {p,update,load,task}=fixture(t);update(task);load('original','/chosen-original',1000,600);
  update({...task,state:'done',subject:'/cutout',kind:'extracted',alignment});load('subject','/cutout',300,300);
  definition.lifetimes.detached.call(p);const before={...p.data};t.mock.timers.tick(10000);assert.deepEqual(p.data,before);
});
test('reselecting the same already-decoded original does not wait for a second native load event',t=>{
  const {p,update,load,task}=fixture(t);update(task);load('original','/chosen-original',1000,600);
  update({...task,id:'again',state:'uploading'});
  update({...task,id:'again',state:'done',subject:'/cutout',kind:'extracted',alignment});
  load('subject','/cutout',300,300);assert.equal(p.data.revealPhase,'aligned');
});
