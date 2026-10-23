const test=require('node:test');
const assert=require('node:assert/strict');
const motion=require('../miniprogram/services/journal-board-motion');
function fixture(t) {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  const oldWx=global.wx;t.after(()=>{global.wx=oldWx;});
  const draws=[],ctx={save(){},restore(){},setTransform(){},clearRect(){},drawImage(...args){draws.push({args,alpha:this.globalAlpha});}};
  global.wx={createOffscreenCanvas:({width,height})=>({width,height,getContext:()=>({drawImage(){}})})};
  const host={data:{model:{id:'first'},covered:false},canvas:{width:900,height:1500,getContext:()=>ctx},screenWidth:300,
    setData(update){Object.assign(this.data,update);},refresh(){this.refreshCount=(this.refreshCount||0)+1;}};
  return {host,draws};
}
test('native board change blends two frames and restores live interaction after 240ms',t=>{
  const {host,draws}=fixture(t);motion.begin(host);host.data.model={id:'second'};
  assert.equal(motion.run(host),true);assert.equal(host.data.navigationAnimating,true);assert.deepEqual(host.data.actions,[]);
  t.mock.timers.tick(128);assert.ok(draws.length>2);assert.equal(host.data.navigationAnimating,true);
  assert.equal(draws.at(-2).alpha,1,'The old frame remains opaque so the blend never flashes white');
  assert.ok(draws.at(-1).alpha>0 && draws.at(-1).alpha<1);
  assert.deepEqual(draws.at(-2).args.slice(1),[0,0,900,1500],'The outgoing board frame stays at the same size and position');
  assert.deepEqual(draws.at(-1).args.slice(1),[0,0,900,1500],'The incoming board frame does not slide or scale');
  t.mock.timers.tick(128);assert.equal(host.data.navigationAnimating,false);assert.equal(host.journalMotion,null);assert.equal(host.refreshCount,1);
});
test('rapid board changes cancel the previous frame loop and settle on the latest board',t=>{
  const {host}=fixture(t);motion.begin(host);host.data.model={id:'second'};motion.run(host);t.mock.timers.tick(64);
  motion.begin(host);assert.equal(host.journalSource.id,'second');assert.equal(host.journalMotion,null);
  host.data.model={id:'third'};motion.run(host);t.mock.timers.tick(256);
  assert.equal(host.data.model.id,'third');assert.equal(host.data.navigationAnimating,false);assert.equal(host.refreshCount,1);
});
test('a picker holds the transition until its exit is complete, and disposal releases all frames',t=>{
  const {host}=fixture(t);motion.begin(host);host.data.model={id:'second'};host.data.covered=true;
  assert.equal(motion.run(host),false);assert.ok(host.journalSource);
  host.data.covered=false;host.data.occluded=true;assert.equal(motion.run(host),false);assert.ok(host.journalSource);
  host.data.occluded=false;motion.run(host);host.dead=true;motion.dispose(host);t.mock.timers.tick(1000);
  assert.equal(host.journalMotion,null);assert.equal(host.journalSource,null);assert.equal(host.refreshCount,undefined);
});
test('same-board selection and unsupported bitmap runtimes keep the normal render path',t=>{
  const {host}=fixture(t);motion.begin(host);assert.equal(motion.run(host),false);assert.equal(host.journalSource,null);
  global.wx={};motion.begin(host);host.data.model={id:'other'};assert.equal(motion.run(host),false);
});
test('a throttled native animation frame never leaves the board interaction locked',t=>{
  const {host}=fixture(t);host.canvas.requestAnimationFrame=()=>1;host.canvas.cancelAnimationFrame=()=>{};
  motion.begin(host);host.data.model={id:'next'};motion.run(host);t.mock.timers.tick(420);
  assert.equal(host.data.navigationAnimating,false);assert.equal(host.journalMotion,null);assert.equal(host.refreshCount,1);
});
