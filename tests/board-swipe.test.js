const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const swipe = require('../miniprogram/services/board-swipe');
const renderer = require('../miniprogram/core/renderer');
const B = require('../miniprogram/core/config').board;

async function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const oldWx = global.wx;
  global.wx = { createOffscreenCanvas: ({ width, height }) => createCanvas(width, height) };
  const events = [], frames = new Map(); let id = 0, refreshes = 0;
  const current = { id: 'a', color: '#D9CBAF', texture: 'fine', items: [] }, next = { ...current, id: 'b', color: '#C3D0BD' };
  const canvas = createCanvas(300, 400 + B.overhang * 300 / B.width);
  canvas.requestAnimationFrame = fn => { frames.set(++id, fn); return id; };
  canvas.cancelAnimationFrame = id => frames.delete(id);
  const host = { canvas, screenWidth: 300, images: {}, version: 1,
    data: { model: current, height: 400, allowSwipe: true, swipeNext: next },
    setData(d) { Object.assign(this.data, d); }, triggerEvent(name, detail) { events.push({ name, detail }); }, refresh() { refreshes++; } };
  const step = (ms = 16) => { t.mock.timers.tick(ms); const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
  const settle = () => { for (let i = 0; i < 25; i++) step(); };
  swipe.warm(host); await host.swipeCache.next.ready;
  t.after(() => { host.dead = true; swipe.dispose(host); global.wx = oldWx; });
  return { host, next, events, frames, step, settle, refreshes: () => refreshes };
}

test('finger tracking draws both prepared boards without rerendering felt on every move', async t => {
  const { host: h, frames, step } = await fixture(t);
  const cached = h.swipeCache.next; swipe.warm(h); assert.equal(h.swipeCache.next, cached);
  const paint = t.mock.method(renderer, 'paint');
  for (const x of [-20, -40, -90]) swipe.update(h, x);
  assert.equal(frames.size, 1); assert.equal(paint.mock.callCount(), 1, 'Only the source bitmap is built');
  step(); assert.equal(h.swipeMotion.x, -90);
  const ctx = h.canvas.getContext('2d');
  const left = Array.from(ctx.getImageData(80, 230, 1, 1).data), right = Array.from(ctx.getImageData(270, 230, 1, 1).data);
  assert.ok(left[3] > 240 && right[3] > 240, 'Both boards remain visible during the slide');
  assert.notDeepEqual(left, right, 'The incoming board uses its own material');
  for (const x of [-100, -120, -150]) { swipe.update(h, x); step(); }
  assert.equal(paint.mock.callCount(), 1); assert.equal(h.data.model.id, 'a');
});

test('release eases continuously into the target and holds it until the live board is ready', async t => {
  const { host: h, next, events, step } = await fixture(t);
  swipe.update(h, -90); step(); swipe.release(h, 1);
  const positions = [];
  for (let i = 0; i < 23; i++) { step(); positions.push(h.swipeMotion.x); }
  assert.ok(positions[0] < -90 && positions[0] > -160, 'Release starts from the finger position');
  assert.ok(positions.every((x, i) => !i || x <= positions[i - 1]));
  assert.ok(new Set(positions).size >= 10, 'The change contains intermediate frames');
  assert.equal(positions.at(-1), -316); assert.equal(swipe.hold(h), true);
  assert.equal(events.filter(e => e.name === 'boardswipe').length, 1);
  assert.deepEqual(events.at(-1), { name: 'boardswipe', detail: { offset: 1, targetId: 'b' } });
  h.data.model = next; assert.equal(swipe.hold(h), false); swipe.beforePaint(h);
  assert.equal(h.swipeMotion, null); assert.equal(h.data.swipeActive, false);
  step(1000); assert.equal(events.filter(e => e.name === 'boardswipe').length, 1);
});

test('short slides and the outer edge rebound without changing boards', async t => {
  const { host: h, events, step, settle } = await fixture(t);
  swipe.update(h, -25); step(); swipe.release(h, 0); step();
  assert.ok(h.swipeMotion.x > -25 && h.swipeMotion.x < 0); settle(); assert.equal(h.swipeMotion, null);
  swipe.update(h, 180); step(); assert.ok(h.swipeMotion.x > 0 && h.swipeMotion.x < 40, 'Boundary motion has resistance');
  swipe.release(h, -1); settle(); assert.equal(h.swipeMotion, null);
  assert.equal(events.some(e => e.name === 'boardswipe'), false); assert.equal(h.data.model.id, 'a');
});

test('reversing direction tracks the finger; cancellation and departure suppress a late commit', async t => {
  const { host: h, events, step, settle, frames } = await fixture(t);
  swipe.update(h, -80); step(); swipe.update(h, 40); step(); assert.ok(h.swipeMotion.x > 0);
  swipe.cancel(h, false); settle(); assert.equal(h.swipeMotion, null);
  swipe.update(h, -100); swipe.release(h, 1); step(); swipe.cancel(h);
  assert.equal(frames.size, 0); settle(); assert.equal(events.some(e => e.name === 'boardswipe'), false);
  swipe.update(h, -100); swipe.release(h, 1); h.dead = true; swipe.dispose(h); settle();
  assert.equal(frames.size, 0); assert.equal(h.swipeCache, null); assert.equal(events.some(e => e.name === 'boardswipe'), false);
});

test('a delayed target stays bounded and a rejected switch restores the source', async t => {
  const { host: h, events, step, settle } = await fixture(t);
  const entry = h.swipeCache.next, target = entry.frame;
  delete entry.frame; let ready; entry.ready = new Promise(resolve => { ready = resolve; });
  swipe.update(h, -100); step(); assert.ok(h.swipeMotion.x > -30);
  swipe.release(h, 1); assert.equal(h.swipeMotion.phase, 'waiting');
  entry.frame = target; ready(); await Promise.resolve(); settle();
  assert.equal(events.filter(e => e.name === 'boardswipe').length, 1);
  swipe.cancel(h, false); settle(); assert.equal(h.swipeMotion, null); assert.equal(h.data.model.id, 'a');
});
