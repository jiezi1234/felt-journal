const test = require('node:test');
const assert = require('node:assert/strict');
const modal = require('../miniprogram/services/modal-presentation');

test('keyboard layout handles both overlaid and already resized viewports without subtracting twice', t => {
  const oldWx = global.wx; t.after(() => { global.wx = oldWx; });
  let info = { windowWidth: 320, windowHeight: 620, screenHeight: 700, safeArea: { bottom: 680 } };
  const listeners = {};
  global.wx = { getWindowInfo: () => info,
    onKeyboardHeightChange(fn) { listeners.keyboard = fn; }, offKeyboardHeightChange(fn) { assert.equal(fn, listeners.keyboard); delete listeners.keyboard; },
    onWindowResize(fn) { listeners.resize = fn; }, offWindowResize(fn) { assert.equal(fn, listeners.resize); delete listeners.resize; }
  };
  const host = { data: {}, setData(data) { Object.assign(this.data, data); } };
  modal.mount(host); assert.equal(host.data.modalHeight, 620); assert.equal(host.data.modalBottom, 30);
  listeners.keyboard({ height: 260 }); assert.equal(host.data.modalHeight, 360); assert.equal(host.data.modalBottom, 10);
  info = { ...info, windowHeight: 360 }; listeners.resize({ size: info }); assert.equal(host.data.modalHeight, 360);
  info = { ...info, windowHeight: 620 }; listeners.keyboard({ height: 0 }); assert.equal(host.data.modalHeight, 620);
  const lateKeyboard = listeners.keyboard; modal.dispose(host); assert.deepEqual(listeners, {});
  lateKeyboard({ height: 260 }); assert.equal(host.data.modalHeight, 620);
});

test('exit keeps the surface mounted, completes once, and cannot close a replacement after detach', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldWx = global.wx; t.after(() => { global.wx = oldWx; }); global.wx = {};
  let exits = 0; const host = { data: {}, setData(data) { Object.assign(this.data, data); } };
  modal.mount(host); modal.close(host, () => exits++); modal.close(host, () => exits++);
  assert.equal(host.data.modalClosing, true); assert.equal(exits, 0);
  t.mock.timers.tick(modal.EXIT_MS); assert.equal(exits, 1);
  const other = { ...host, data: {} }; modal.mount(other); modal.close(other, () => exits++); modal.dispose(other);
  t.mock.timers.tick(1000); assert.equal(exits, 1);
});

test('shared-photo exit keeps its measured layout when the native keyboard disappears', t => {
  const oldWx=global.wx;t.after(()=>{global.wx=oldWx;});
  global.wx={getWindowInfo:()=>({windowWidth:390,windowHeight:800})};
  const host={data:{},setData(d){Object.assign(this.data,d);}};
  modal.mount(host);host.modalPresentation.keyboardChanged({height:300});
  assert.equal(host.data.modalHeight,500);modal.freeze(host);
  host.modalPresentation.keyboardChanged({height:0});host.modalPresentation.resized({size:{windowWidth:390,windowHeight:800}});
  assert.equal(host.data.modalHeight,500,'A closing paper and its flight image must not jump to the expanded viewport');
  modal.thaw(host);assert.equal(host.data.modalHeight,800,'A fallback card recovers its live viewport');
  modal.dispose(host);
});
