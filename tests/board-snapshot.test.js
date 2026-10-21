const test = require('node:test');
const assert = require('node:assert/strict');
const snapshots = require('../miniprogram/services/board-snapshot');
function fixture(t) {
  t.mock.timers.enable({apis:['setTimeout']});
  const oldWx=global.wx;t.after(()=>{global.wx=oldWx;});global.wx={nextTick:fn=>fn()};
  let frames=[];
  const host={version:1,data:{covered:false,snapshot:'',snapshotSlot:'a',snapshotVisible:false,canvasHidden:false},
    canvas:{requestAnimationFrame(fn){if(host.dead)throw Error('Detached canvas');frames.push(fn);}},setData(d,done){Object.assign(this.data,d);if(done)done();}};
  const frame=()=>{const pending=frames;frames=[];pending.forEach(fn=>fn());};
  const load=(path,slot)=>snapshots.loaded(host,{currentTarget:{dataset:{path,slot}}});
  t.after(()=>snapshots.dispose(host));
  return {host,frame,load};
}
test('opening keeps the canvas until a decoded raster has been presented',async t=>{
  const {host:h,frame,load}=fixture(t);
  h.data.covered=true;snapshots.cover(h);
  const staged=snapshots.stage(h,'/first.png',()=>true);
  assert.equal(h.data.canvasHidden,false);assert.equal(h.data.snapshotVisible,false);
  load('/first.png','b');assert.equal(await staged,true);
  assert.equal(h.data.snapshotVisible,true);assert.equal(h.data.canvasHidden,false);
  frame();assert.equal(h.data.canvasHidden,false);frame();assert.equal(h.data.canvasHidden,true);
});
test('replacing a covered snapshot keeps the old decoded buffer until the new one loads',async t=>{
  const {host:h,frame,load}=fixture(t);h.data.covered=true;
  const first=snapshots.stage(h,'/whole.png',()=>true);load('/whole.png','b');await first;frame();frame();
  const next=snapshots.stage(h,'/lift.png',()=>true);
  assert.equal(h.data.snapshot,'/whole.png');assert.equal(h.data.snapshotB,'/whole.png');assert.equal(h.data.snapshotSlot,'b');
  assert.equal(h.data.snapshotVisible,true);assert.equal(h.data.canvasHidden,true);
  load('/lift.png','a');assert.equal(await next,true);assert.equal(h.data.snapshotSlot,'a');assert.equal(h.data.snapshot,'/lift.png');
});
test('closing keeps the raster through canvas show and paint; a quick reopen cannot release it',async t=>{
  const {host:h,frame}=fixture(t);
  Object.assign(h.data,{snapshot:'/ready.png',snapshotVisible:true,canvasHidden:true,covered:true});
  h.data.covered=false;snapshots.cover(h);
  assert.equal(h.data.canvasHidden,false);assert.equal(h.data.snapshotVisible,true);
  snapshots.painted(h,1);frame();assert.equal(h.data.snapshotVisible,true);
  h.data.covered=true;snapshots.cover(h);frame();frame();
  assert.equal(h.data.snapshotVisible,true);assert.equal(h.data.canvasHidden,true);
  h.data.covered=false;snapshots.cover(h);snapshots.painted(h,1);frame();frame();assert.equal(h.data.snapshotVisible,false);
});
test('a late load, decode error or timeout never removes the last good frame',async t=>{
  const {host:h,load}=fixture(t);Object.assign(h.data,{snapshot:'/ready.png',snapshotB:'/ready.png',snapshotSlot:'b',snapshotVisible:true,canvasHidden:true,covered:true});
  const old=snapshots.stage(h,'/old.png',()=>true),current=snapshots.stage(h,'/new.png',()=>true);assert.equal(await old,false);
  load('/old.png','a');assert.equal(h.data.snapshot,'/ready.png');
  snapshots.failed(h,{currentTarget:{dataset:{path:'/new.png',slot:'a'}}});assert.equal(await current,false);
  const timeout=snapshots.stage(h,'/timeout.png',()=>true);t.mock.timers.tick(800);assert.equal(await timeout,false);
  load('/timeout.png','a');assert.equal(h.data.snapshot,'/ready.png');assert.equal(h.data.snapshotVisible,true);
});
test('preloading completes before opening and stale or detached loads cannot replace the board',async t=>{
  const {host:h,load}=fixture(t);
  const preload=snapshots.stage(h,'/preloaded.png',()=>!h.data.covered);load('/preloaded.png','b');assert.equal(await preload,true);
  assert.equal(h.data.snapshotVisible,false);assert.equal(h.data.canvasHidden,false);
  const stale=snapshots.stage(h,'/stale.png',()=>!h.data.covered);h.data.covered=true;load('/stale.png','a');assert.equal(await stale,false);
  const detached=snapshots.stage(h,'/detached.png',()=>true);h.dead=true;snapshots.dispose(h);load('/detached.png','a');assert.equal(await detached,false);
  assert.equal(h.data.snapshot,'/preloaded.png');
});
test('detaching during presentation never schedules another frame on the destroyed canvas',t=>{
  const {host:h,frame}=fixture(t);Object.assign(h.data,{covered:true,snapshot:'/ready.png'});
  snapshots.cover(h);h.dead=true;snapshots.dispose(h);frame();frame();assert.equal(h.data.canvasHidden,false);
});

test('return preload decodes without exposing a duplicate object and commits only on landing',async t=>{
  const {host:h,load}=fixture(t);
  Object.assign(h.data,{covered:true,snapshot:'/lift.png',snapshotA:'/lift.png',snapshotVisible:true,canvasHidden:true});
  const preparing=snapshots.stage(h,'/whole.png',()=>true,true);
  load('/whole.png','b');const prepared=await preparing;
  assert.equal(h.data.snapshot,'/lift.png');assert.equal(h.data.snapshotSlot,'a');
  assert.equal(h.data.snapshotVisible,true);assert.equal(h.data.canvasHidden,true);
  assert.equal(await snapshots.commit(h,prepared),true);assert.equal(h.data.snapshot,'/whole.png');
  assert.equal(await snapshots.commit(h,prepared),false,'Commit is consumed once');
});

test('invalidated or detached return preloads never replace the last decoded frame',async t=>{
  const {host:h,load}=fixture(t);Object.assign(h.data,{covered:true,snapshot:'/lift.png',snapshotVisible:true,canvasHidden:true});
  let valid=true;
  const first=snapshots.stage(h,'/first.png',()=>valid,true);load('/first.png','b');const stale=await first;
  valid=false;assert.equal(await snapshots.commit(h,stale),false);
  const second=snapshots.stage(h,'/second.png',()=>true,true);load('/second.png','b');const replaced=await second;
  assert.equal(await snapshots.commit(h,stale),false);h.dead=true;snapshots.dispose(h);
  assert.equal(await snapshots.commit(h,replaced),false);assert.equal(h.data.snapshot,'/lift.png');
});
