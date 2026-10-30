const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
let definition; global.Component = value => { definition = value; };
require('../miniprogram/components/recall-subject/index'); delete global.Component;

function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = global.wx, exports = [], images = [], events = [];
  global.wx = { createOffscreenCanvas: ({ width, height }) => createCanvas(width, height), canvasToTempFilePath: options => exports.push(options) };
  const canvas = createCanvas(640, 432);
  canvas.createImage = () => { const image = createCanvas(180, 180), ctx = image.getContext('2d'); ctx.fillStyle = '#B98142'; ctx.fillRect(30, 30, 45, 120); ctx.fillRect(30, 100, 120, 50); images.push(image); return image; };
  const c = { ...definition.methods, canvas, data: { ...definition.data, path: '/a.png', memoryId: 'a' },
    setData(update) { Object.assign(this.data, update); }, triggerEvent(type, detail) { events.push({ type, detail }); } };
  t.after(() => { definition.lifetimes.detached.call(c); global.wx = previous; });
  return { c, canvas, exports, images, events };
}

test('detail snapshot has a transparent background and a visible white silhouette seam', t => {
  const { c, canvas, images, exports } = fixture(t); c.render(); images[0].onload();
  assert.equal(exports.length, 1); assert.equal(exports[0].fileType, 'png');
  const pixels = canvas.getContext('2d').getImageData(0, 0, 640, 432).data;
  assert.equal(pixels[3], 0);
  let white = 0; for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 245 && pixels[i + 1] > 245 && pixels[i + 2] > 245 && pixels[i + 3] > 240) white++;
  assert.ok(white > 500);
  exports[0].success({ tempFilePath: '/preview.png' });
  assert.equal(c.data.previewPath, '/preview.png'); assert.equal(c.data.pending, false);
});

test('fast switching and closing discard stale loads and snapshot callbacks', t => {
  const { c, images, exports } = fixture(t); c.render(); images[0].onload();
  c.data.path = '/b.png'; c.data.memoryId = 'b'; c.render();
  exports[0].success({ tempFilePath: '/stale.png' }); assert.equal(c.data.previewPath, '');
  images[0].onload(); assert.equal(exports.length, 1);
  images[1].onload(); exports[1].success({ tempFilePath: '/b-preview.png' }); assert.equal(c.data.previewPath, '/b-preview.png');
  c.data.path = '/c.png'; c.render(); images[2].onload(); definition.lifetimes.detached.call(c);
  exports[2].success({ tempFilePath: '/closed.png' }); assert.equal(c.data.previewPath, '');
});

test('export failure, decode failure and timeout retain the original photo without hiding the memory', t => {
  const { c, images, exports, events } = fixture(t); c.render(); images[0].onload(); exports[0].fail();
  assert.equal(c.data.pending, false); assert.equal(c.data.previewPath, ''); assert.deepEqual(events, []);
  c.render(); t.mock.timers.tick(1800); assert.equal(c.data.pending, false);
  images[1].onload(); exports[1].success({ tempFilePath: '/broken-preview.png' });
  c.imageFailed({ currentTarget: { dataset: { path: '/a.png', preview: '/broken-preview.png' } } });
  assert.equal(c.data.previewPath, ''); assert.deepEqual(events, []);
  c.imageFailed({ currentTarget: { dataset: { path: '/stale.png', preview: '' } } }); assert.deepEqual(events, []);
  c.imageFailed({ currentTarget: { dataset: { path: '/a.png', preview: '' } } });
  assert.deepEqual(events, [{ type: 'imageerror', detail: { id: 'a', path: '/a.png' } }]);
});
