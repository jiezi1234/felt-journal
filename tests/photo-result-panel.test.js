const test = require('node:test');
const assert = require('node:assert/strict');
let component;
global.Component = definition => { component = definition; };
require('../miniprogram/components/photo-panel/index'); delete global.Component;
test('newly edited results leave original comparison and display the saved crop, including original-background crops', () => {
  const p = { data: { ...component.data }, setData(data) { Object.assign(this.data, data); } };
  const original = { state: 'done', original: '/photo.png', subject: '/cutout.png', kind: 'extracted' };
  component.observers.task.call(p, original); p.data.showOriginal = true;
  component.observers.task.call(p, { ...original, subject: '/cropped.png' });
  assert.equal(p.data.showOriginal, false); assert.equal(p.data.displayImage, '/cropped.png');
  component.observers.task.call(p, { ...original, subject: '/cropped-background.png', kind: 'original' });
  assert.equal(p.data.displayImage, '/cropped-background.png'); assert.equal(p.data.canCompare, false);
});

test('continuing from original comparison measures the saved subject after reflow and ignores stale results', t => {
  const originalWx = global.wx; t.after(() => { global.wx = originalWx; });
  let afterLayout, measured, callback; const events = [];
  global.wx = { nextTick(fn) { afterLayout = fn; } };
  const task = { state: 'done', original: '/original', subject: '/subject' };
  const p = { ...component.methods, data: { task, done: true, showOriginal: true, displayImage: task.original },
    setData(data, done) { Object.assign(this.data, data); if (done) done(); },
    createSelectorQuery() { measured = this.data.displayImage; return { select() { return this; }, boundingClientRect(fn) { callback = fn; return this; }, exec() {} }; },
    triggerEvent(name, detail) { events.push({ name, detail }); }
  };
  p.continueLayout(); assert.equal(p.data.displayImage, '/subject'); assert.equal(measured, undefined);
  afterLayout(); assert.equal(measured, '/subject'); callback({ width: 200, height: 100 });
  assert.equal(events.length, 1); assert.equal(events[0].name, 'continue'); assert.equal(events[0].detail.rect.width, 200);
  p.continueLayout(); p.dead = true; callback({ width: 99 }); assert.equal(events.length, 1);
});

test('cancel invalidates both a pending measurement and a queued keyboard continuation', t => {
  const originalWx = global.wx; t.after(() => { global.wx = originalWx; });
  let measured, afterLayout; const events = [];
  global.wx = { hideKeyboard() {}, nextTick(fn) { afterLayout = fn; } };
  const p = { ...component.methods, data: { task: { state: 'done' }, done: true, inline: true },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect(fn) { measured = fn; return this; }, exec() {} }; },
    triggerEvent(name) { events.push(name); }
  };
  p.continueLayout(); p.cancel(); measured({ width: 200, height: 100 });
  assert.deepEqual(events, ['cancel']);
  p.data.keyboard = true; p.continueLayout(); p.data.keyboard = false;
  component.observers.keyboard.call(p, false); p.cancel(); afterLayout();
  assert.deepEqual(events, ['cancel', 'cancel']); assert.equal(p.continuing, null);
});

test('continue with the inline keyboard waits for restored image bounds and ignores a detached result', t => {
  const originalWx = global.wx; t.after(() => { global.wx = originalWx; });
  let hidden = 0, measured = 0, afterLayout;
  global.wx = { hideKeyboard() { hidden++; }, nextTick(fn) { afterLayout = fn; } };
  const task = { state:'done', subject:'/subject' };
  const p = { ...component.methods, data:{ task, done:true, inline:true, keyboard:true },
    createSelectorQuery() { measured++; return { select() { return this; }, boundingClientRect() { return this; }, exec() {} }; }
  };
  p.continueLayout(); p.continueLayout(); assert.equal(hidden, 1); assert.equal(measured, 0);
  p.data.keyboard = false; component.observers.keyboard.call(p, false);
  assert.equal(measured, 0); afterLayout(); assert.equal(measured, 1);
  p.data.keyboard = true; p.continueLayout(); p.data.keyboard = false;
  component.observers.keyboard.call(p, false); component.lifetimes.detached.call(p); afterLayout();
  assert.equal(measured, 1);
});
