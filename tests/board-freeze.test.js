const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = require('../miniprogram/core/renderer');
const snapshots = require('../miniprogram/services/board-snapshot');
let definition;
global.Component = value => { definition = value; };
require('../miniprogram/components/felt-board/index');
delete global.Component;
const observe = board => definition.observers['covered, interactive, occluded, freezeCanvas'].call(board);

function fixture(t) {
  const previous = global.wx, exports = [], paints = [], queries = [];
  global.wx = { nextTick: fn => fn(), canvasToTempFilePath: request => exports.push(request), getSystemInfoSync: () => ({ pixelRatio: 2 }) };
  t.after(() => { global.wx = previous; snapshots.dispose(board); });
  t.mock.method(renderer, 'loadImages', async () => ({}));
  t.mock.method(renderer, 'createSurface', () => null);
  t.mock.method(renderer, 'paint', (ctx, model) => paints.push(model.id));
  t.mock.method(renderer, 'paintControls', () => {});
  const board = { ...definition.methods, screenWidth: 300,
    data: { ...definition.data, model: { id: 'today', items: [] }, height: 400, interactive: true, snapshot: '/ready.png' },
    canvas: { width: 600, height: 800, getContext: () => ({ setTransform() {} }) },
    setData(update, done) { Object.assign(this.data, update); if (done) done(); },
    createSelectorQuery() { return { select() { return this; }, fields() { return this; }, boundingClientRect() { return this; }, exec(fn) { queries.push(fn); } }; }
  };
  return { board, exports, paints, queries };
}

test('static overlays do not load, paint, resize or export the hidden native canvas', async t => {
  const { board: b, exports, paints, queries } = fixture(t);
  Object.assign(b.data, { covered: true, occluded: true, freezeCanvas: true }); observe(b);
  await b.refresh(); b.measure(); b.touchCancel();
  b.data.model = { id: 'changed-under-menu', items: [] };
  definition.observers['model, editable, selected, landingId, floatingControls'].call(b);
  assert.equal(await b.prepareOverlay(), true, 'Menu-to-library navigation reuses the decoded raster');
  assert.equal(renderer.loadImages.mock.callCount(), 0);
  assert.deepEqual(paints, []); assert.deepEqual(exports, []); assert.deepEqual(queries, []);
  assert.equal(b.data.snapshot, '/ready.png'); assert.equal(b.data.snapshotVisible, true); assert.equal(b.data.canvasHidden, true);
});

test('a pre-menu image load cannot paint after a quick open/close; resuming paints the latest board', async t => {
  const { board: b, paints } = fixture(t); let resolve;
  renderer.loadImages.mock.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = b.refresh();
  Object.assign(b.data, { freezeCanvas: true, covered: true, occluded: true }); observe(b);
  Object.assign(b.data, { freezeCanvas: false, covered: false, occluded: false, model: { id: 'latest', items: [] } });
  resolve({}); await pending;
  assert.deepEqual(paints, [], 'The invalidated render cannot return even after the menu closes');
  observe(b); await Promise.resolve();
  assert.deepEqual(paints, ['latest']); assert.equal(b.data.canvasHidden, false);
});

test('a queued measurement cannot resize the hidden canvas, and closing measures again', async t => {
  const { board: b, queries } = fixture(t);
  b.measure();
  Object.assign(b.data, { freezeCanvas: true, covered: true, occluded: true }); observe(b);
  queries[0]([{ node: b.canvas }, { width: 360, height: 650 }]);
  b.measure(); assert.equal(queries.length, 1); assert.equal(b.canvas.width, 600);
  Object.assign(b.data, { freezeCanvas: false, covered: false, occluded: false }); observe(b);
  assert.equal(queries.length, 2);
  queries[1]([{ node: b.canvas }, { width: 360, height: 650 }]);
  assert.equal(b.canvas.width, 720); assert.equal(b.screenWidth, 360);
  await Promise.resolve();
});

test('an export already in flight cannot replace the menu raster after freezing', async t => {
  const { board: b, exports } = fixture(t);
  Object.assign(b.data, { covered: true, occluded: true });
  await b.refresh(); assert.equal(exports.length, 1);
  const stage = t.mock.method(snapshots, 'stage', async () => true);
  b.data.freezeCanvas = true; observe(b);
  exports[0].success({ tempFilePath: '/late.png' });
  assert.equal(stage.mock.callCount(), 0); assert.equal(b.data.snapshot, '/ready.png');
});

test('a timed-out overlay preparation cannot stage its late capture under the menu', async t => {
  const { board: b, exports } = fixture(t);
  const stage = t.mock.method(snapshots, 'stage', async () => true);
  const pending = b.prepareOverlay(); await Promise.resolve(); await Promise.resolve();
  assert.equal(exports.length, 1);
  Object.assign(b.data, { freezeCanvas: true, occluded: true }); observe(b);
  exports[0].success({ tempFilePath: '/late.png' });
  assert.equal(await pending, false); assert.equal(stage.mock.callCount(), 0);
});

test('switching from a static menu to appearance resumes live texture previews while covered', async t => {
  const { board: b, exports, paints } = fixture(t);
  Object.assign(b.data, { covered: true, occluded: true, freezeCanvas: true }); observe(b);
  b.data.freezeCanvas = false; observe(b); await Promise.resolve();
  assert.deepEqual(paints, ['today']); assert.equal(exports.length, 1);
  b.data.model = { id: 'updated-texture', items: [] }; await b.refresh();
  assert.deepEqual(paints, ['today', 'updated-texture']); assert.equal(exports.length, 2);
});
