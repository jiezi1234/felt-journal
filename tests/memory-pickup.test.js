const test = require('node:test');
const assert = require('node:assert/strict');
const pickup = require('../miniprogram/services/memory-pickup');
const owner = require('../miniprogram/services/board-memory');
const motion = require('../miniprogram/core/sticker-motion');
function fixture(t) {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const previous = global.wx; t.after(() => { global.wx = previous; });
  global.wx = { createAnimation() {
    let pose = {}, steps = [];
    const animation = { step(options) { steps.push({ ...pose, ...options }); return this; }, export() { const result = steps; steps = []; return { steps:result }; } };
    for (const key of ['translate','rotate','scale','opacity']) animation[key] = (...values) => { pose[key] = values; return animation; };
    return animation;
  } };
  const events = [], bounds = [
    { left:0, top:0, width:390, height:800 },
    { left:20, top:140, width:350, height:520 },
    { left:44, top:164, width:302, height:420 }
  ];
  const host = { data:{ memoryId:'photo',source:{ id:'photo',rect:{ left:42,top:210,width:90,height:60,angle:348 } },memory:{ subjectPath:'/photo.png',width:600,height:400 } },
    setData(data,done) { Object.assign(this.data,data); if (done) done(); }, triggerEvent(name,detail) { events.push({ name,detail }); },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect() { return this; }, exec(done) { done(bounds); } }; }
  };
  pickup.mount(host); t.after(() => pickup.dispose(host));
  const load = flight => pickup.imageLoaded(host,{ detail:{ width:600,height:400 } },flight);
  const open = () => { pickup.ready(host); load(false); load(true); pickup.begin(host,true); t.mock.timers.tick(pickup.OPEN_MS+40); };
  return { host,events,bounds,load,open };
}
test('pickup waits for both decoded photo layers and the board handoff, then reveals one card image', t => {
  const f = fixture(t), h = f.host;
  pickup.ready(h); f.load(false); assert.equal(f.events.length,0);
  f.load(true); assert.equal(f.events.at(-1).name,'pickuplift'); assert.equal(h.data.pickupPhase,'waiting');
  assert.equal(h.data.pickupBusy,true); assert.equal(h.pickup.from.angle,-12,'A 348-degree placement must not spin a full turn');
  t.mock.timers.tick(300); assert.equal(h.data.pickupPhase,'waiting');
  pickup.begin(h,true); assert.equal(h.data.pickupPhase,'opening');
  assert.equal(h.data.pickupPaperAnimation.steps.length,1,'No unchanged native step may block paper unfolding');
  assert.equal(h.data.pickupPaperAnimation.steps[0].delay,60);
  t.mock.timers.tick(pickup.OPEN_MS+40); assert.equal(h.data.pickupPhase,'open'); assert.equal(h.data.pickupBusy,false);
  assert.deepEqual(h.data.memory,{ subjectPath:'/photo.png',width:600,height:400 });
});
test('closing flips the back first, remeasures a changed destination and keeps the photo until its board restores', t => {
  const f = fixture(t), h = f.host; f.open(); h.data.flipped = true;
  let closes = 0; pickup.close(h,() => closes++); pickup.close(h,() => closes++);
  assert.equal(h.data.flipped,false); assert.equal(f.events.at(-1).name,'pickuplift');
  t.mock.timers.tick(pickup.FLIP_MS+30); assert.equal(f.events.at(-1).name,'pickupreturn');
  const home = { left:90,top:620,width:105,height:70,angle:22 };
  pickup.returnTo(h,home); assert.equal(h.data.pickupPhase,'returning');
  const target = h.pickup.bounds.target, transform = h.pickup.from;
  assert.equal(target.left+target.width/2+transform.x,home.left+home.width/2);
  assert.equal(target.top+target.height/2+transform.y,home.top+home.height/2);
  assert.ok(Math.abs(target.width*transform.scale-home.width)<1e-8);
  assert.equal(transform.angle,22);
  t.mock.timers.tick(pickup.CLOSE_MS+39); assert.equal(closes,0);
  t.mock.timers.tick(1); assert.equal(closes,1); assert.equal(h.data.pickupPhase,'landed');
  t.mock.timers.tick(5000); assert.equal(closes,1);
});
test('failed snapshots, image timeouts, recovered text and interruption leave a usable card and restore the board', t => {
  const f = fixture(t), h = f.host;
  pickup.ready(h); f.load(false); f.load(true); pickup.begin(h,false);
  assert.equal(h.data.pickupEnabled,false); assert.equal(f.events.at(-1).name,'pickuprestore');
  assert.deepEqual(h.data.pickupPaperAnimation.steps[0].scale,[1],'Fallback restores a full-size paper');
  assert.deepEqual(h.data.pickupPaperAnimation.steps[0].opacity,[1]);
  pickup.begin(h,true); assert.equal(h.data.pickupEnabled,false,'A late capture cannot restart a failed entrance');
  pickup.mount(h); pickup.ready(h); t.mock.timers.tick(1800);
  assert.equal(h.data.pickupBusy,false); assert.equal(h.data.pickupEnabled,false);
  pickup.mount(h); h.data.editing = true; h.data.flipped = true; pickup.ready(h); f.load(false); f.load(true);
  assert.equal(h.data.pickupEnabled,false); assert.equal(h.data.editing,true); assert.equal(h.data.flipped,true);
  h.data.editing = false; h.data.flipped = false; pickup.mount(h); f.open();
  pickup.close(h,() => {}); pickup.interrupted(h);
  assert.equal(h.data.pickupEnabled,false); assert.equal(h.data.pickupBusy,false);
});
test('detaching cancels pending measurements, entrance timers and close callbacks', t => {
  const f = fixture(t), h = f.host;
  pickup.ready(h); f.load(false); f.load(true); pickup.begin(h,true); pickup.dispose(h);
  t.mock.timers.tick(5000); assert.equal(h.data.pickupPhase,'opening');
  pickup.begin(h,true); assert.equal(h.data.pickupPhase,'opening');
});

test('closing after a rapid flip back waits for the photo plane before measuring', t => {
  const f=fixture(t), h=f.host; f.open(); h.data.flipped=false; h.lastFlipAt=Date.now();
  pickup.close(h,()=>{});
  assert.equal(f.events.at(-1).name,'pickuplift'); assert.equal(h.data.pickupBusy,true);
  t.mock.timers.tick(pickup.FLIP_MS+30);
  assert.equal(f.events.at(-1).name,'pickupreturn');
});
test('pickup endpoints fit wide and tall photos at rotated placements without changing aspect ratio', () => {
  for (const image of [{ width:800,height:200 },{ width:180,height:700 }]) for (const angle of [0,37,180,348]) {
    const source = { ...motion.imageRect({ left:18,top:530,width:120,height:100 },image),angle };
    const target = motion.imageRect({ left:35,top:140,width:320,height:480 },image), pose = motion.pickupTransform(source,target);
    assert.ok(Math.abs(target.width*pose.scale-source.width)<1e-8); assert.ok(Math.abs(target.height*pose.scale-source.height)<1e-8);
    assert.ok(pose.angle>=-180&&pose.angle<=180);
  }
  assert.equal(motion.pickupTransform(null,{}),null);
});
test('owner ignores late opening after navigation and does not dismiss before restoring the source', async () => {
  let prepared, restored;
  const board = { pickupId:'photo',preparePickup:() => new Promise(resolve => { prepared = resolve; }),setPickupHidden:() => new Promise(resolve => { restored = resolve; }) };
  const host = { date:'2026-10-21',data:{ memoryCardId:'' },selectComponent:s => s==='#today-board'?board:null,
    setData(d) { Object.assign(this.data,d); },refresh() {},syncNavigation() {} };
  const pending = owner.open(host,'photo'); assert.equal(host.memoryOpening,true); owner.cancel(host);
  prepared({ rect:{ left:10,top:10,width:20,height:20 } }); await pending; assert.equal(host.data.memoryCardId,'');
  host.data.memoryCardId = 'photo'; const closing = owner.close(host);
  assert.equal(host.data.memoryCardId,'photo'); restored(true); await closing; assert.equal(host.data.memoryCardId,'');
});
