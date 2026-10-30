const test = require('node:test');
const assert = require('node:assert/strict');
const backdrop = require('../miniprogram/services/recall-backdrop');
const snapshots = require('../miniprogram/services/board-snapshot');
function fixture(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const previous = global.wx, captures = [];
  global.wx = { canvasToTempFilePath: options => captures.push(options) };
  const host = { canvas: { width: 780, height: 1500 }, data: { model: { id: 'today', items: [], color: 'beige' }, floatingControls: { recall: { id: 'old' } } } };
  const stage = t.mock.method(snapshots, 'stage', async (h, path, valid) => { if (!valid()) return false; h.data.snapshot = path; return true; });
  t.after(() => { backdrop.cancel(host); global.wx = previous; });
  return { host, captures, stage };
}
test('idle backdrop is decoded once and reused only for the same board and viewport', async t => {
  const { host: h, captures } = fixture(t);
  backdrop.warm(h); t.mock.timers.tick(100); backdrop.warm(h); t.mock.timers.tick(20);
  assert.equal(captures.length, 1); assert.equal(backdrop.ready(h), false);
  captures[0].success({ tempFilePath: '/ready.png' }); await Promise.resolve(); assert.equal(backdrop.ready(h), true);
  backdrop.warm(h); t.mock.timers.tick(1000); assert.equal(captures.length, 1);
  h.data.model.color = 'green'; assert.equal(backdrop.ready(h), false);
  h.data.model.color = 'beige'; h.canvas.width = 900; assert.equal(backdrop.ready(h), false);
  h.canvas.width = 780; h.data.snapshot = '/another.png'; assert.equal(backdrop.ready(h), false);
});
test('interaction cancels prewarming; stale exports never overwrite a new board or covered snapshot', async t => {
  const { host: h, captures, stage } = fixture(t);
  backdrop.warm(h); h.gesture = {}; backdrop.warm(h); t.mock.timers.tick(200); assert.equal(captures.length, 0);
  h.gesture = null; backdrop.warm(h); t.mock.timers.tick(120);
  h.data.model.id = 'another-day'; captures[0].success({ tempFilePath: '/stale.png' }); assert.equal(stage.mock.callCount(), 0);
  backdrop.warm(h); t.mock.timers.tick(120); backdrop.cancel(h); h.data.covered = true;
  captures[1].success({ tempFilePath: '/late.png' }); assert.equal(stage.mock.callCount(), 0);
  h.data.covered = false; backdrop.warm(h); t.mock.timers.tick(120); h.pageHidden = true;
  captures[2].success({ tempFilePath: '/background.png' }); assert.equal(stage.mock.callCount(), 0);
});
