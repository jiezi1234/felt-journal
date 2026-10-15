const test = require('node:test');
const assert = require('node:assert/strict');
const { PhotoTask } = require('../miniprogram/services/photo-task');
const platform = require('../miniprogram/services/platform');
const extraction = require('../miniprogram/services/extraction');
const { createStore } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
test('task cancellation, idempotency, save retries and replacement safety', async t => {
  const originals = { ...platform }, extract = extraction.extract;
  t.after(() => { Object.assign(platform, originals); extraction.extract = extract; });
  let removed = [], shouldFail = false, count = 0;
  platform.choose = async () => ({ path: '/tmp/photo.jpg', width: 400, height: 300 });
  platform.persist = async (_, name) => `/saved/${name}.png`;
  platform.unlink = async p => removed.push(p);
  platform.collect = async () => {};
  platform.call = async () => ({ width: 400, height: 300 });
  function fixture(memoryId, date) {
    const disk = {}; const store = createStore({ get: k => disk[k], set: (k, v) => { if (shouldFail) throw new Error('quota'); disk[k] = v; } }); const states = [];
    const task = new PhotoTask({ store, memoryId, date: date || dates.key(), onState: state => states.push(state), onDone: () => count++, onCancel() {} }); return { task, store, states };
  }
  await t.test('late extraction callback cannot insert after cancellation', async () => {
    let resolve; extraction.extract = () => new Promise(r => { resolve = r; });
    const f = fixture(), running = f.task.start('album');
    await new Promise(r => setImmediate(r)); await f.task.cancel(); resolve('/tmp/subject.png'); await running;
    assert.equal(Object.keys(f.store.get().memories).length, 0); assert.ok(removed.length > 0);
  });
  await t.test('failed extraction never silently uses original; explicit fallback and duplicate save insert once', async () => {
    extraction.extract = async () => { throw new Error('unavailable'); };
    const f = fixture(undefined, '2024-02-29'); await f.task.start('album'); assert.equal(f.states.at(-1).state, 'extractError'); assert.equal(f.store.board('2024-02-29').placements.length, 0);
    await f.task.process(true); await f.task.save(); await f.task.process(true); assert.equal(f.store.board('2024-02-29').placements.length, 1); assert.equal(Object.values(f.store.get().memories)[0].kind, 'original');
  });
  await t.test('save failure retains extracted result and original for retry without re-extraction', async () => {
    let calls = 0; extraction.extract = async () => { calls++; return '/tmp/cutout.png'; }; const f = fixture(); shouldFail = true;
    await f.task.start('album'); assert.equal(f.states.at(-1).state, 'saveError'); assert.equal(Object.keys(f.store.get().memories).length, 0);
    shouldFail = false; await f.task.save(); assert.equal(calls, 1); assert.equal(f.store.board(dates.key()).placements.length, 1); assert.equal(f.task.owned.length, 0);
  });
  await t.test('cancel while copying cannot leak late file or create a record', async () => {
    let resolve; platform.persist = () => new Promise(r => { resolve = r; }); const f = fixture(), running = f.task.start('camera'); await new Promise(r => setImmediate(r));
    await f.task.cancel(); resolve('/saved/late.png'); await running; assert.ok(removed.includes('/saved/late.png')); assert.equal(f.store.board(dates.key()).placements.length, 0);
    platform.persist = async (_, name) => `/saved/${name}.png`;
  });
  await t.test('failed or cancelled replacement preserves old image and layout', async () => {
    const f = fixture(); extraction.extract = async () => '/tmp/cutout.png'; await f.task.start('album'); const id = f.store.board(dates.key()).placements[0].memoryId, old = f.store.get();
    extraction.extract = async () => { throw new Error('failure'); };
    const replacement = new PhotoTask({ store: f.store, memoryId: id, date: dates.key(), onState() {}, onDone() {}, onCancel() {} });
    await replacement.start('album'); await replacement.cancel(); assert.deepEqual(f.store.get(), old);
  });
});
test('remote adapter validates HTTP, JSON and cutout URL, cancels network', async t => {
  const before = { ...config.extraction }; const wxBefore = global.wx;
  t.after(() => { Object.assign(config.extraction, before); global.wx = wxBefore; });
  Object.assign(config.extraction, { mode: 'remote', endpoint: 'https://felt.example/extract' });
  const results = [{ statusCode: 500 }, { statusCode: 200, data: 'broken' }, { statusCode: 200, data: '{"cutoutUrl":"http://unsafe"}' }];
  for (const response of results) { global.wx = { uploadFile(o) { queueMicrotask(() => o.success(response)); return { abort() {} }; } }; await assert.rejects(extraction.extract('/photo', {}, () => {})); }
  let aborted = false; global.wx = { uploadFile() { return { abort() { aborted = true; } }; } }; const task = {}, promise = extraction.extract('/photo', task, () => {}); task.cancelled = true; task.abort(); await assert.rejects(promise, /取消/); assert.ok(aborted);
});
