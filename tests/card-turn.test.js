const test = require('node:test');
const assert = require('node:assert/strict');
const turn = require('../miniprogram/services/card-turn');
const pickup = require('../miniprogram/services/memory-pickup');
function fixture(t) {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const host = { data:{flipped:false,flipBusy:false},setData(d,done){Object.assign(this.data,d);if(done)done();} };
  return {host,half:()=>t.mock.timers.tick(turn.HALF_MS+turn.SETTLE_MS)};
}
test('turn swaps the visible face at the fold and releases interactions only after it opens', t=>{
  const {host:h,half}=fixture(t);let done=0;
  turn.turn(h,true,()=>done++);assert.equal(h.data.flipped,false);assert.equal(h.data.flipBusy,true);
  half();assert.equal(h.data.flipped,true);assert.equal(h.data.turning,false);assert.equal(done,0);
  half();assert.equal(h.data.flipBusy,false);assert.equal(done,1);
});
test('return requested mid-turn cancels stale callbacks and settles on the front once',t=>{
  const {host:h,half}=fixture(t);const done=[];
  turn.turn(h,true,()=>done.push('old'));half();
  turn.turn(h,false,()=>done.push('front'));half();half();
  assert.equal(h.data.flipped,false);assert.equal(h.data.flipBusy,false);assert.deepEqual(done,['front']);
  turn.turn(h,true,()=>done.push('detached'));turn.cancel(h);half();half();assert.deepEqual(done,['front']);
});
test('pickup close waits for an in-progress flat turn even before its back face is visible',t=>{
  const {host:h,half}=fixture(t),events=[];
  h.data.memory={id:'one'};h.data.memoryId='one';h.pickup={enabled:true,phase:'open',sequence:0};
  h.turnTo=(back,done)=>turn.turn(h,back,done);h.triggerEvent=name=>events.push(name);
  h.turnTo(true);pickup.close(h,()=>{});assert.deepEqual(events,[]);
  half();half();assert.equal(h.data.flipped,false);assert.deepEqual(events,['pickupreturn']);pickup.dispose(h);
});
