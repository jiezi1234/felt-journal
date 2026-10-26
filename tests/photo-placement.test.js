const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const { createBoardEditor } = require('../miniprogram/services/board-editor');
const photo = require('../miniprogram/services/page-photo');
const platform = require('../miniprogram/services/platform');
const extraction = require('../miniprogram/services/extraction');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
let card;
global.Component = definition => { card = definition; };
require('../miniprogram/components/record-card/index');
delete global.Component;
const tick = () => new Promise(resolve => setImmediate(resolve));
const photos = { originalPath: '/seed.jpg', subjectPath: '/seed.png', width: 400, height: 300 };
const flight = { detail: { rect: { left: 20, top: 100, width: 280, height: 220 } } };

function fixture(t, theme = false) {
  const original = { ...platform }, originalExtract = extraction.extract;
  t.after(() => { Object.assign(platform, original); extraction.extract = originalExtract; });
  const disk = {}, events = []; let failing = false;
  const storage = { get: key => disk[key], set(key, value) { if (failing && key === KEY) throw Error('disk full'); disk[key] = value; } };
  const store = createStore(storage), date = theme ? store.createTheme('pending', '旅行') : dates.key();
  const controller = createBoardEditor({ embedded: !theme });
  const page = { ...controller, ...(!theme ? card.methods : {}), store, date, wantEdit: true, data: clone(controller.data),
    setData(update) { Object.assign(this.data, update); }, triggerEvent(name, detail) { events.push({ name, detail }); } };
  platform.choose = async () => ({ path: '/tmp/photo.jpg' });
  platform.persist = async (_, name) => `/saved/${name}.png`;
  platform.unlink = platform.collect = platform.localNotice = async () => {};
  platform.unloadGuard = platform.toast = platform.back = () => {};
  platform.call = async () => ({ width: 400, height: 300 });
  extraction.extract = async () => '/tmp/cutout.png';
  page.refresh();
  t.after(() => clearTimeout(page.placementTimer));
  return { page, store, storage, events, date, fail(value) { failing = value; } };
}

for (const theme of [false, true]) {
  test(`${theme ? 'theme' : 'daily'}: close after extraction preserves the board and keeps an unplaced library photo`, async t => {
    const f = fixture(t, theme), p = f.page;
    const existing = f.store.add('existing', dates.key(), photos, f.date); p.refresh();
    const before = f.store.board(f.date);
    await p.album(); const id = p.photoNoteId;
    assert.equal(p.data.task.state, 'done'); assert.notEqual(id, existing);
    assert.deepEqual(f.store.board(f.date), before); assert.equal(p.data.count, 1);
    p.openPhotoNote(); p.photoNoteInput({ detail: { value: '留在记忆库' } });
    await p.back(); p.onUnload();
    const reopened = createStore(f.storage);
    assert.deepEqual(reopened.board(f.date), before);
    assert.equal(reopened.get().memories[id].text, '留在记忆库');
    assert.deepEqual(reopened.boardsForMemory(id), []);
    assert.equal(f.events.some(e => e.name === 'place'), false);
    reopened.place(id, f.date);
    assert.equal(reopened.board(f.date).placements.length, 2, 'Canceled result remains available from the library');
  });

  test(`${theme ? 'theme' : 'daily'}: only Continue places the result, once, before the flight starts`, async t => {
    const f = fixture(t, theme), p = f.page;
    await p.camera(); const id = p.photoNoteId;
    assert.equal(f.store.board(f.date).placements.length, 0);
    p.continuePhoto(flight); const committed = f.store.get(); p.continuePhoto(flight);
    assert.deepEqual(f.store.get(), committed);
    assert.deepEqual(f.store.boardsForMemory(id).map(b => b.id), [f.date]);
    if (theme) {
      assert.equal(p.data.placing.id, id); p.stickerLanded({ detail: { token: p.data.placing.token } });
    } else {
      assert.equal(f.events.filter(e => e.name === 'place').length, 1);
      assert.equal(f.events.find(e => e.name === 'place').detail.id, id);
    }
  });
}

test('extraction finishing while the close confirmation is open never places the completed result', async t => {
  const f = fixture(t), p = f.page; let extracted, confirmed;
  extraction.extract = () => new Promise(resolve => { extracted = resolve; });
  const processing = p.album(); await tick();
  platform.call = method => method === 'showModal' ? new Promise(resolve => { confirmed = resolve; }) : Promise.resolve({ width: 400, height: 300 });
  const closing = p.back(); extracted('/tmp/result.png'); await processing;
  const id = p.photoNoteId; p.continuePhoto(flight);
  assert.equal(f.events.some(e => e.name === 'place'), false);
  confirmed({ confirm: true }); await closing;
  assert.equal(p.data.task, null); assert.ok(f.store.get().memories[id]);
  assert.equal(f.store.get().boards[f.date], undefined);
  assert.equal(f.events.filter(e => e.name === 'close').length, 1);
});

test('late Continue callback during the card exit and after unload cannot place a result', async t => {
  const f = fixture(t), p = f.page; await p.album();
  p.data.modalClosing = true; p.continuePhoto(flight);
  assert.equal(f.store.board(f.date).placements.length, 0);
  p.onUnload(); p.continuePhoto(flight);
  assert.equal(f.store.board(f.date).placements.length, 0);
  assert.equal(f.events.some(e => e.name === 'place'), false);
});

test('failed placement leaves the result open and retries once without extracting or saving another memory', async t => {
  const f = fixture(t), p = f.page; await p.album(); const id = p.photoNoteId, before = f.store.get();
  f.fail(true); p.continuePhoto(flight);
  assert.deepEqual(f.store.get(), before); assert.equal(p.data.task.state, 'done'); assert.ok(p.data.task.error);
  assert.equal(f.events.some(e => e.name === 'place'), false);
  f.fail(false); p.continuePhoto(flight); p.continuePhoto(flight);
  assert.equal(f.store.board(f.date).placements.length, 1); assert.equal(Object.keys(f.store.get().memories).length, 1);
  assert.equal(f.events.filter(e => e.name === 'place').length, 1); assert.equal(p.data.selected, id);
});

test('target capacity is rechecked at Continue; failure can be closed without losing the library result', async t => {
  const f = fixture(t, true), p = f.page; await p.album(); const id = p.photoNoteId;
  for (let i = 0; i < config.maxItems; i++) f.store.add('fill_' + i, dates.key(), photos, f.date);
  const before = f.store.board(f.date); p.continuePhoto(flight);
  assert.match(p.data.task.error, /最多/); assert.equal(p.data.placing, null);
  await p.cancelPhoto(); assert.deepEqual(f.store.board(f.date), before); assert.deepEqual(f.store.boardsForMemory(id), []);
});

test('reselecting, retrying, cropping and keeping the original all preserve pending placement', async t => {
  const f = fixture(t), p = f.page; await p.album(); const id = p.photoNoteId, firstTask = p.photoTask;
  let choices = [2, 0];
  platform.call = async method => method === 'showActionSheet' ? { tapIndex: choices.shift() } : { width: 400, height: 300 };
  platform.choose = async () => { throw Error('permission denied'); };
  await photo.adjustResult(p); assert.equal(p.data.task.state, 'sourceError');
  await p.retryPhoto(); assert.equal(p.data.task.state, 'sourceError');
  await p.cancelPhoto(); assert.equal(p.photoTask, firstTask);
  platform.choose = async () => ({ path: '/tmp/reselected.jpg' }); choices = [2, 1];
  await photo.adjustResult(p); assert.equal(p.photoNoteId, id); assert.equal(p.photoTask.deferPlacement, true);
  const memory = f.store.get().memories[id];
  f.store.editSubject('crop_pending', id, memory, { subjectPath: '/cropped.png', width: 200, height: 200, kind: 'extracted' });
  photo.refreshResult(p); choices = [1]; await photo.adjustResult(p);
  assert.equal(p.data.task.kind, 'original'); assert.equal(Object.keys(f.store.get().memories).length, 1);
  assert.equal(f.store.get().boards[f.date], undefined);
  p.continuePhoto(flight); assert.equal(f.store.board(f.date).placements[0].memoryId, id);
});
