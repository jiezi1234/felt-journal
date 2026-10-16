const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = require('../miniprogram/core/renderer');
let definition;
global.Component = value => { definition = value; };
require('../miniprogram/components/felt-board/index');
delete global.Component;

test('covered boards retain a snapshot but ignore callbacks after reopening or detaching', async t => {
  const originalWx = global.wx, originalRenderer = { ...renderer }, requests = [];
  t.after(() => { global.wx = originalWx; Object.assign(renderer, originalRenderer); });
  global.wx = { canvasToTempFilePath: request => requests.push(request) };
  renderer.loadImages = async () => ({}); renderer.paint = () => {}; renderer.paintControls = () => {};
  const board = Object.assign({}, definition.methods, {
    data: { model: { items: [] }, covered: true, editable: false, snapshot: '', selected: '' },
    canvas: { width: 600, height: 400, getContext: () => ({ setTransform() {} }) }, screenWidth: 300,
    setData(value) { Object.assign(this.data, value); }
  });
  await board.refresh(); assert.equal(requests.length, 1);
  board.data.covered = false; await board.refresh(); requests[0].success({ tempFilePath: '/late.png' });
  assert.equal(board.data.snapshot, '', 'Returning to live editing must ignore a late snapshot');
  board.data.covered = true; await board.refresh(); requests[1].success({ tempFilePath: '/current.png' });
  assert.equal(board.data.snapshot, '/current.png');
  await board.refresh(); board.dead = true; requests[2].success({ tempFilePath: '/detached.png' });
  assert.equal(board.data.snapshot, '/current.png', 'Detached cards must not update their UI');
});

test('covered boards do not respond to pointer input underneath a card', () => {
  const board = Object.assign({}, definition.methods, { data: { covered: true, interactive: true, model: { items: [] } },
    createSelectorQuery() { throw new Error('Background board must not start a gesture'); } });
  board.touchStart({ touches: [{ clientX: 10, clientY: 10 }] }); assert.equal(board.gesture, undefined);
});
