const test = require('node:test');
const assert = require('node:assert/strict');
const motion = require('../miniprogram/core/sticker-motion');
const geometry = require('../miniprogram/core/geometry');
const { createBoardEditor } = require('../miniprogram/services/board-editor');
const { createStore, clone } = require('../miniprogram/core/store');
const platform = require('../miniprogram/services/platform');
const dates = require('../miniprogram/core/date');

test('flight uses actual contained photo bounds and reaches the saved board coordinates', () => {
  for (const image of [{ width: 800, height: 400 }, { width: 200, height: 600 }]) {
    for (const boardWidth of [270, 324, 480]) {
      const source = motion.imageRect({ left: 30, top: 200, width: 300, height: 280 }, image);
      const p = { ...geometry.create('m', image.width, image.height, 0, 0), memory: image, angle: 15 };
      const target = motion.landingRect({ left: 33, top: 310, width: boardWidth, height: boardWidth * 2 / 3 }, p);
      const end = motion.transform(source, target);
      assert.ok(Math.abs(source.width * end.scale - target.width) < .00001);
      assert.ok(Math.abs(source.height * end.scale - target.height) < .00001);
      assert.ok(Math.abs(source.left + source.width / 2 + end.x - target.left - target.width / 2) < .00001);
      assert.ok(Math.abs(source.top + source.height / 2 + end.y - target.top - target.height / 2) < .00001);
      assert.equal(end.angle, 15);
    }
  }
  assert.equal(motion.imageRect(null, { width: 1, height: 1 }), null);
  assert.equal(motion.landingRect({ left: 0, top: 0, width: 0, height: 0 }, {}), null);
});

test('placement locks gestures, keeps one saved record and ignores stale completion', t => {
  const oldGuard = platform.unloadGuard, oldNotice = platform.localNotice;
  platform.unloadGuard = () => {}; platform.localNotice = async () => {};
  t.after(() => { platform.unloadGuard = oldGuard; platform.localNotice = oldNotice; });
  const disk = {}, store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } });
  const date = dates.key(), id = store.add('test', date, { originalPath: '/a', subjectPath: '/b', width: 400, height: 300, kind: 'extracted' });
  const controller = createBoardEditor(), page = Object.assign({}, controller, { store, date, data: clone(controller.data), setData(update) { Object.assign(this.data, update); } });
  page.refresh(); page.photoDone(id); page.photoTask = { committed: true }; page.data.task = { state: 'done' };
  t.after(() => clearTimeout(page.placementTimer));
  const saved = JSON.stringify(store.get());
  page.continuePhoto({ detail: { rect: { left: 30, top: 150, width: 300, height: 300 } } });
  const flight = page.data.placing;
  assert.ok(flight); assert.equal(flight.id, id); assert.ok(page.photoTask.committed); assert.equal(page.data.task.state, 'done'); assert.equal(page.canAdjust(), false);
  page.stickerLifted({ detail: { token: flight.token - 1 } }); assert.ok(page.photoTask);
  page.stickerLifted({ detail: { token: flight.token } }); assert.equal(page.photoTask, null); assert.equal(page.data.task, null);
  page.cancelPhoto(); assert.equal(page.data.placing, flight);
  page.stickerTarget({ detail: { id: 'wrong', target: { left: 0, top: 0, width: 20, height: 20 } } }); assert.equal(page.data.placing.target, undefined);
  page.stickerTarget({ detail: { id, target: { left: 50, top: 300, width: 80, height: 60 } } }); assert.equal(page.data.placing.target.width, 80);
  page.stickerLanded({ detail: { token: flight.token - 1 } }); assert.ok(page.data.placing);
  page.stickerLanded({ detail: { token: flight.token } }); assert.equal(page.data.placing, null); assert.equal(page.canAdjust(), true);
  assert.equal(JSON.stringify(store.get()), saved);
});

test('recovered peel mesh is flat at start/end and continuous across source/home handoff', () => {
  const { rows, ease } = require('../miniprogram/core/sticker-peel');
  const width = 300, height = 240, amplitude = 240 * .16;
  const flat = rows(width, height, 0, false, amplitude), landed = rows(width, height, 1, true, amplitude);
  for (let i = 0; i <= 24; i++) {
    assert.equal(flat[i].left, 0); assert.equal(flat[i].right, width); assert.equal(flat[i].y, i / 24 * height);
    assert.deepEqual(landed[i], flat[i]);
  }
  assert.deepEqual(rows(width, height, 1, false, amplitude), rows(width, height, 0, true, amplitude));
  const halfway = rows(width, height, .5, false, amplitude);
  assert.ok(halfway[0].lift > halfway[24].lift, 'Top lifts before the bottom');
  for (let i = 1; i <= 24; i++) assert.ok(halfway[i].y > halfway[i - 1].y, 'No inverted texture strips');
  assert.equal(ease(0), 0); assert.equal(ease(1), 1); assert.ok(ease(.5) > .7 && ease(.5) < .85);
});

test('mesh tessellation leaves no transparent seams inside an opaque sticker', () => {
  const { createCanvas } = require('@napi-rs/canvas'), { paint } = require('../miniprogram/core/sticker-peel');
  const image = createCanvas(300, 240), source = image.getContext('2d');
  source.fillStyle = '#BB2222'; source.fillRect(0, 0, 300, 240);
  for (const landing of [false, true]) {
    const canvas = createCanvas(360, 300), ctx = canvas.getContext('2d'); ctx.translate(30, 30);
    paint(ctx, image, 300, 240, .5, landing, 38.4);
    const pixels = ctx.getImageData(180, 30, 1, 220).data;
    for (let i = 0; i < pixels.length; i += 4) {
      assert.equal(pixels[i + 3], 255);
      [187, 34, 34].forEach((channel, index) => assert.ok(Math.abs(pixels[i + index] - channel) <= 1));
    }
  }
});
