const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../miniprogram/core/store');
const { createBoardEditor } = require('../miniprogram/services/board-editor');
const feedback = require('../miniprogram/services/board-feedback');
const platform = require('../miniprogram/services/platform');
const dates = require('../miniprogram/core/date');

function fixture(t) {
  t.mock.timers.enable({ apis:['setTimeout'] });
  const oldGuard = platform.unloadGuard; platform.unloadGuard = () => {};
  t.after(() => { platform.unloadGuard = oldGuard; });
  const disk = {}; let fail = false;
  const storage = { get:key => disk[key], set(key,value) { if (fail) throw Error('write failed'); disk[key] = value; } };
  const store = createStore(storage), date = dates.key();
  store.add('feedback', date, { originalPath:'/original.jpg', subjectPath:'/subject.png', width:400, height:300 });
  const editor = createBoardEditor(), host = { ...editor, date, store, draft:store.board(date), dirty:false,
    data:{ ...editor.data }, setData(value) { Object.assign(this.data, value); } };
  return { host, storage, fail(value) { fail = value; } };
}

test('learning is write-free until the next layout save, then survives restart without changing a placement', t => {
  const f = fixture(t), before = f.host.store.board(f.host.date);
  const revision = f.host.store.get().revision; feedback.learn(f.host);
  assert.equal(f.host.data.showBoardGuide, false);
  assert.equal(f.host.store.get().revision, revision);
  f.host.dirty = true; f.host.persist();
  const restored = createStore(f.storage); restored.load();
  assert.equal(restored.get().boardGuideSeen, true);
  assert.deepEqual(restored.board(f.host.date), before);
});

test('only a successful changed layout shows feedback; failed saves retain a retry and cannot claim success', t => {
  const f = fixture(t), p = f.host;
  assert.equal(p.persist(), true); assert.equal(p.data.layoutSaved, false);
  p.dirty = true; assert.equal(p.persist(), true); assert.equal(p.data.layoutSaved, true);
  t.mock.timers.tick(1800); assert.equal(p.data.layoutSaved, false);
  p.dirty = true; f.fail(true); assert.equal(p.persist(), false);
  assert.equal(p.data.layoutSaved, false); assert.equal(p.dirty, true); assert.ok(p.data.saveError);
  f.fail(false); p.retrySave(); assert.equal(p.data.layoutSaved, true); assert.equal(p.data.saveError, '');
  feedback.reset(p); t.mock.timers.tick(2000); assert.equal(p.data.layoutSaved, false);
});

test('guidance needs no storage write and cannot block the current gesture when storage is full', t => {
  const f = fixture(t); f.fail(true); assert.doesNotThrow(() => feedback.learn(f.host));
  assert.equal(f.host.guideLearned, true); assert.equal(f.host.data.showBoardGuide, false);
});
