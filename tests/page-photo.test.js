const test = require('node:test');
const assert = require('node:assert/strict');
const photo = require('../miniprogram/services/page-photo');
const platform = require('../miniprogram/services/platform');
const extraction = require('../miniprogram/services/extraction');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const { createBoardEditor } = require('../miniprogram/services/board-editor');
const dates = require('../miniprogram/core/date');
let memoryDefinition;
global.Page = definition => { memoryDefinition = definition; };
require('../miniprogram/pages/memory/index');
delete global.Page;
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(t) {
  const originals = { ...platform }, originalExtract = extraction.extract;
  t.after(() => { Object.assign(platform, originals); extraction.extract = originalExtract; });
  const disk = {}, removed = [], states = [], guards = [], completed = [];
  let failSave = false, requests = 0, notices = 0;
  const store = createStore({ get: key => disk[key], set(key, value) { if (failSave && key === KEY) throw new Error('disk full'); disk[key] = value; } });
  const page = { store, data: { task: null }, setData(update) { Object.assign(this.data, update); if (update.task) states.push(update.task); }, photoDone(id) { completed.push(id); } };
  platform.choose = async () => ({ path: '/tmp/original.jpg', width: 400, height: 300 });
  platform.persist = async (_, name) => `/saved/${name}.png`;
  platform.unlink = async path => removed.push(path);
  platform.collect = async () => {};
  platform.call = async () => ({ width: 400, height: 300 });
  platform.unloadGuard = enabled => guards.push(enabled);
  platform.localNotice = async () => { notices++; };
  extraction.extract = async (_, task, stage) => { requests++; stage('uploading'); stage('extracting'); return '/tmp/subject.png'; };
  return { page, store, removed, states, guards, completed, date: dates.key(), failSave(value) { failSave = value; }, get requests() { return requests; }, get notices() { return notices; } };
}

test('selected photo waits for confirmation; committed result stays visible until Continue', async t => {
  const f = fixture(t), p = f.page;
  await photo.begin(p, 'album', { date: f.date });
  assert.equal(p.data.task.state, 'preview'); assert.match(p.data.task.original, /_original\.png$/);
  assert.equal(f.requests, 0); assert.equal(Object.keys(f.store.get().memories).length, 0);
  assert.equal(f.states.find(s => s.state === 'persisting').original, '/tmp/original.jpg');
  await photo.retry(p);
  assert.equal(p.data.task.state, 'done'); assert.equal(p.data.task.kind, 'extracted'); assert.equal(p.data.task.committed, true);
  assert.match(p.data.task.subject, /_subject\.png$/); assert.equal(f.states.find(s => s.state === 'saving').subject, '/tmp/subject.png');
  assert.equal(f.completed.length, 1); assert.equal(p.photoTask.committed, true); assert.equal(f.guards.at(-1), false);
  assert.equal(f.notices, 0); assert.equal(Object.keys(f.store.get().memories).length, 1);
  await photo.retry(p); await photo.original(p); assert.equal(f.requests, 1);
  photo.cancel(p); photo.cancel(p);
  assert.equal(p.data.task, null); assert.equal(p.photoTask, null); assert.equal(f.notices, 1);
  assert.equal(Object.keys(f.store.get().memories).length, 1); assert.deepEqual(f.removed, []);
});

test('canceling preview removes its owned photo without invoking extraction', async t => {
  const f = fixture(t); await photo.begin(f.page, 'camera', { date: f.date });
  const original = f.page.data.task.original;
  await photo.cancel(f.page);
  assert.equal(f.page.data.task, null); assert.equal(f.requests, 0); assert.deepEqual(f.removed, [original]);
  assert.equal(Object.keys(f.store.get().memories).length, 0);
});

test('late copy and old callbacks cannot clear a new photo task', async t => {
  const f = fixture(t), p = f.page; let finishCopy;
  platform.persist = () => new Promise(resolve => { finishCopy = resolve; });
  const firstRun = photo.begin(p, 'camera', { date: f.date }); await tick(); const old = p.photoTask;
  await photo.cancel(p);
  platform.persist = async (_, name) => `/saved/${name}.png`;
  await photo.begin(p, 'album', { date: f.date }); const next = p.photoTask;
  finishCopy('/saved/late-original.png'); await firstRun;
  old.onState({ state: 'extractError', error: 'late' }); old.onDone('late'); old.onCancel();
  assert.equal(p.photoTask, next); assert.equal(p.data.task.state, 'preview'); assert.deepEqual(f.completed, []);
  assert.ok(f.removed.includes('/saved/late-original.png'));
});

test('retrying save uses the retained result, then exposes a saved completion', async t => {
  const f = fixture(t), p = f.page;
  await photo.begin(p, 'album', { date: f.date }); f.failSave(true); await photo.retry(p);
  assert.equal(p.data.task.state, 'saveError'); assert.equal(p.data.task.kind, 'extracted'); assert.ok(p.data.task.subject);
  assert.equal(f.guards.at(-1), true); assert.equal(f.completed.length, 0);
  f.failSave(false); await photo.retry(p);
  assert.equal(f.requests, 1); assert.equal(p.data.task.state, 'done'); assert.equal(f.completed.length, 1);
});

test('explicit original fallback finishes with original kind and a single commit', async t => {
  const f = fixture(t), p = f.page;
  extraction.extract = async () => { throw new Error('offline'); };
  await photo.begin(p, 'album', { date: f.date }); await photo.retry(p);
  assert.equal(p.data.task.state, 'extractError');
  await photo.original(p); await photo.original(p);
  assert.equal(p.data.task.state, 'done'); assert.equal(p.data.task.kind, 'original');
  assert.equal(Object.values(f.store.get().memories)[0].kind, 'original'); assert.equal(f.completed.length, 1);
});

test('source retry reselects a photo and requires a fresh confirmation', async t => {
  const f = fixture(t), p = f.page; let attempts = 0;
  platform.choose = async () => { if (!attempts++) throw new Error('permission denied'); return { path: '/tmp/new.jpg' }; };
  await photo.begin(p, 'camera', { date: f.date }); assert.equal(p.data.task.state, 'sourceError'); assert.equal(p.data.task.permission, true);
  const first = p.photoTask; await photo.retry(p);
  assert.notEqual(p.photoTask, first); assert.equal(p.data.task.state, 'preview'); assert.equal(f.requests, 0);
});

test('unloading cancels pending work and ignores late results; committed pictures survive unload', async t => {
  const f = fixture(t), p = f.page; let resolve;
  await photo.begin(p, 'album', { date: f.date });
  extraction.extract = () => new Promise(done => { resolve = done; });
  const processing = photo.retry(p); await photo.dispose(p); resolve('/tmp/late.png'); await processing;
  assert.equal(p.photoTask, null); assert.equal(p.data.task, null); assert.deepEqual(f.completed, []);
  assert.equal(Object.keys(f.store.get().memories).length, 0);
  await photo.begin(p, 'album', { date: f.date }); assert.equal(p.photoTask, null);

  const second = { ...p, disposed: false, data: { task: null } };
  extraction.extract = async () => '/tmp/subject.png';
  await photo.begin(second, 'album', { date: f.date }); await photo.retry(second);
  const count = f.removed.length; await photo.dispose(second);
  assert.equal(second.data.task, null); assert.equal(f.removed.length, count); assert.equal(Object.keys(f.store.get().memories).length, 1);
});

test('closing a completed board card skips cancellation and keeps the refreshed draft', async t => {
  const f = fixture(t), controller = createBoardEditor({ embedded: true }), events = [];
  const p = Object.assign({}, controller, { data: clone(controller.data), store: f.store, date: f.date, wantEdit: true,
    setData(update) { Object.assign(this.data, update); }, triggerEvent(event) { events.push(event); }, selectComponent() { return { touchCancel() {} }; } });
  p.refresh(); await photo.begin(p, 'album', { date: f.date }); await photo.retry(p);
  assert.equal(p.data.task.state, 'done'); assert.equal(p.draft.placements.length, 1); assert.equal(p.data.count, 1);
  platform.call = async () => { throw new Error('A committed result must not show a cancellation prompt'); };
  await p.back(); p.onUnload();
  assert.equal(p.photoTask, null); assert.ok(events.includes('close')); assert.equal(f.store.board(f.date).placements.length, 1);
});

test('memory close handles completion during confirmation and does not cancel the saved replacement', async t => {
  const f = fixture(t), photos = { originalPath: '/old.jpg', subjectPath: '/old.png', width: 400, height: 300, kind: 'extracted' };
  const id = f.store.add('old', f.date, photos), p = Object.assign({}, memoryDefinition, { data: clone(memoryDefinition.data), store: f.store, id,
    setData(update) { Object.assign(this.data, update); } });
  p.refresh(); await photo.begin(p, 'album', { date: f.date, memoryId: id });
  let confirm, navigations = 0;
  platform.call = method => method === 'showModal' ? new Promise(resolve => { confirm = resolve; }) : Promise.resolve({ width: 400, height: 300 });
  platform.back = () => { navigations++; };
  const closing = p.back(); await p.back(); await photo.retry(p);
  assert.equal(p.data.task.state, 'done'); assert.notEqual(p.data.memory.subjectPath, '/old.png');
  confirm({ confirm: true }); await closing;
  assert.equal(navigations, 1); assert.equal(p.photoTask, null); assert.equal(p.data.task, null);
  assert.equal(Object.keys(f.store.get().memories).length, 1); assert.notEqual(f.store.get().memories[id].subjectPath, '/old.png');
});

test('closing an already completed memory skips the unsaved-photo confirmation', async t => {
  const f = fixture(t), p = Object.assign({}, memoryDefinition, f.page); let navigations = 0;
  p.photoTask = { committed: true }; p.data.task = { state: 'done', committed: true };
  platform.call = async () => { throw new Error('No confirmation expected'); }; platform.back = () => { navigations++; };
  await p.back(); assert.equal(navigations, 1); assert.equal(p.photoTask, null); assert.equal(p.data.task, null);
});
