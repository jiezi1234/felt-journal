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

function adjustmentCalls(choices, calls = []) {
  platform.call = async (method, options) => {
    calls.push({ method, options });
    if (method === 'showActionSheet') return { tapIndex: choices.shift() };
    return { width: 600, height: 300 };
  };
  return calls;
}
test('result crop entry saves the caption and returning refreshes the result without another memory', async t => {
  const f = fixture(t), p = f.page; await photo.begin(p, 'album', { date: f.date });
  const id = p.photoNoteId, old = f.store.get().memories[id], board = f.store.board(f.date);
  photo.inputNote(p, { detail: { value: '保留说明' } });
  const calls = adjustmentCalls([0]); await photo.adjustResult(p);
  assert.ok(calls.some(c => c.method === 'navigateTo' && c.options.url.includes('from=result')));
  assert.equal(f.store.get().memories[id].text, '保留说明');
  f.store.editSubject('crop', id, old, { subjectPath: '/cropped.png', width: 300, height: 300, kind: 'extracted' });
  photo.refreshResult(p); assert.equal(p.data.task.subject, '/cropped.png');
  assert.deepEqual(f.store.board(f.date), board); assert.equal(Object.keys(f.store.get().memories).length, 1);
});
test('keeping original updates only the subject and preserves caption and board placement', async t => {
  const f = fixture(t), p = f.page; await photo.begin(p, 'album', { date: f.date });
  const id = p.photoNoteId, old = f.store.get().memories[id], boards = clone(f.store.get().boards);
  f.store.edit(id, '说明', '心情'); adjustmentCalls([1]); await photo.adjustResult(p);
  const next = f.store.get().memories[id];
  assert.equal(next.originalPath, old.originalPath); assert.notEqual(next.subjectPath, old.subjectPath);
  assert.equal(next.text, '说明'); assert.equal(next.category, '心情'); assert.equal(next.kind, 'original');
  assert.equal(p.data.task.subject, next.subjectPath); assert.equal(p.data.photoAdjusting, false);
  assert.deepEqual(f.store.get().boards, boards); assert.equal(Object.keys(f.store.get().memories).length, 1);
});
test('failed original save keeps the accepted image and allows retry', async t => {
  const f = fixture(t), p = f.page; await photo.begin(p, 'album', { date: f.date });
  const before = f.store.get(), subject = p.data.task.subject;
  f.failSave(true); adjustmentCalls([1]); await photo.adjustResult(p);
  assert.deepEqual(f.store.get(), before); assert.equal(p.data.task.subject, subject);
  assert.equal(p.data.task.state, 'done'); assert.ok(p.data.photoAdjustmentError); assert.equal(p.data.photoAdjusting, false);
  f.failSave(false); adjustmentCalls([1]); await photo.adjustResult(p); assert.equal(p.data.task.kind, 'original');
});
test('cancelled reselection restores the same result and saved caption', async t => {
  const f = fixture(t), p = f.page; await photo.begin(p, 'album', { date: f.date });
  photo.inputNote(p, { detail: { value: '不要丢掉' } }); const id = p.photoNoteId, original = p.photoTask;
  platform.choose = async () => { throw { errMsg: 'chooseMedia:fail cancel' }; };
  adjustmentCalls([2, 0]); await photo.adjustResult(p);
  assert.equal(p.photoTask, original); assert.equal(p.data.task.state, 'done'); assert.equal(p.photoNoteId, id);
  assert.equal(p.data.photoNoteText, '不要丢掉'); assert.equal(Object.keys(f.store.get().memories).length, 1);
});
test('replacement extraction failure can cancel back; successful replacement retains the memory id and layouts', async t => {
  const f = fixture(t), p = f.page; await photo.begin(p, 'album', { date: f.date });
  const id = p.photoNoteId, old = f.store.get().memories[id], boards = clone(f.store.get().boards);
  f.store.edit(id, '原说明', '出行'); extraction.extract = async () => { throw Error('offline'); };
  adjustmentCalls([2, 0]); await photo.adjustResult(p); assert.equal(p.data.task.state, 'extractError');
  assert.equal(f.store.get().memories[id].subjectPath, old.subjectPath);
  await photo.cancel(p); assert.equal(p.data.task.state, 'done'); assert.equal(p.data.task.subject, old.subjectPath);
  extraction.extract = async () => '/new-result.png'; adjustmentCalls([2, 1]); await photo.adjustResult(p);
  assert.equal(p.photoNoteId, id); assert.equal(Object.keys(f.store.get().memories).length, 1);
  assert.notEqual(f.store.get().memories[id].subjectPath, old.subjectPath);
  assert.equal(f.store.get().memories[id].text, '原说明'); assert.equal(f.store.get().memories[id].category, '出行');
  assert.deepEqual(f.store.get().boards, boards);
});
test('reselection source errors can retry without losing the fallback result', async t => {
  const f = fixture(t), p = f.page; await photo.begin(p, 'album', { date: f.date }); const old = p.photoTask;
  platform.choose = async () => { throw Error('permission denied'); };
  adjustmentCalls([2, 0]); await photo.adjustResult(p); assert.equal(p.data.task.state, 'sourceError');
  await photo.retry(p); assert.equal(p.data.task.state, 'sourceError');
  await photo.cancel(p); assert.equal(p.photoTask, old); assert.equal(p.data.task.state, 'done');
});
test('busy adjustments block completion and duplicate actions; unload prevents a late image update', async t => {
  const f = fixture(t), p = f.page; await photo.begin(p, 'album', { date: f.date }); const before = f.store.get();
  let complete; platform.persist = () => new Promise(resolve => { complete = resolve; }); adjustmentCalls([1]);
  const operation = photo.adjustResult(p); await tick(); assert.equal(p.data.photoAdjusting, true);
  assert.equal(photo.finish(p), false); await photo.adjustResult(p); await photo.cancel(p); assert.ok(p.photoTask);
  await photo.dispose(p); complete('/saved/late-adjustment.png'); await operation; await tick();
  assert.deepEqual(f.store.get(), before); assert.ok(f.removed.includes('/saved/late-adjustment.png'));
});

test('selected photo starts automatically; committed result stays visible until Continue', async t => {
  const f = fixture(t), p = f.page;
  await photo.begin(p, 'album', { date: f.date });
  assert.equal(p.data.task.state, 'done'); assert.match(p.data.task.original, /_original\.png$/);
  assert.equal(f.requests, 1); assert.equal(f.states.some(s => s.state === 'preview'), false);
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

test('canceling automatic processing removes its owned photo and ignores a late result', async t => {
  const f = fixture(t); let complete;
  extraction.extract = (_, task, stage) => { stage('extracting'); return new Promise(resolve => { complete = resolve; }); };
  const pending = photo.begin(f.page, 'camera', { date: f.date }); await tick();
  const original = f.page.data.task.original;
  await photo.cancel(f.page);
  complete('/late.png'); await pending;
  assert.equal(f.page.data.task, null); assert.deepEqual(f.removed, [original]);
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
  assert.equal(p.photoTask, next); assert.equal(p.data.task.state, 'done'); assert.equal(f.completed.length, 1); assert.notEqual(f.completed[0], 'late');
  assert.ok(f.removed.includes('/saved/late-original.png'));
});

test('retrying save uses the retained result, then exposes a saved completion', async t => {
  const f = fixture(t), p = f.page;
  f.failSave(true); await photo.begin(p, 'album', { date: f.date });
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

test('source retry reselects a photo and automatically processes it once', async t => {
  const f = fixture(t), p = f.page; let attempts = 0;
  platform.choose = async () => { if (!attempts++) throw new Error('permission denied'); return { path: '/tmp/new.jpg' }; };
  await photo.begin(p, 'camera', { date: f.date }); assert.equal(p.data.task.state, 'sourceError'); assert.equal(p.data.task.permission, true);
  const first = p.photoTask; await photo.retry(p);
  assert.notEqual(p.photoTask, first); assert.equal(p.data.task.state, 'done'); assert.equal(f.requests, 1);
});

test('unloading cancels pending work and ignores late results; committed pictures survive unload', async t => {
  const f = fixture(t), p = f.page; let resolve;
  extraction.extract = () => new Promise(done => { resolve = done; });
  const processing = photo.begin(p, 'album', { date: f.date }); await tick(); await photo.dispose(p); resolve('/tmp/late.png'); await processing;
  assert.equal(p.photoTask, null); assert.equal(p.data.task, null); assert.deepEqual(f.completed, []);
  assert.equal(Object.keys(f.store.get().memories).length, 0);
  await photo.begin(p, 'album', { date: f.date }); assert.equal(p.photoTask, null);

  const second = { ...p, disposed: false, data: { task: null } };
  extraction.extract = async () => '/tmp/subject.png';
  await photo.begin(second, 'album', { date: f.date }); await photo.retry(second);
  const count = f.removed.length; await photo.dispose(second);
  assert.equal(second.data.task, null); assert.equal(f.removed.length, count); assert.equal(Object.keys(f.store.get().memories).length, 1);
});

test('closing a completed board card keeps the photo in the library without placing it', async t => {
  const f = fixture(t), controller = createBoardEditor({ embedded: true }), events = [];
  const p = Object.assign({}, controller, { data: clone(controller.data), store: f.store, date: f.date, wantEdit: true,
    setData(update) { Object.assign(this.data, update); }, triggerEvent(event) { events.push(event); }, selectComponent() { return { touchCancel() {} }; } });
  p.refresh(); await p.album(); await photo.retry(p);
  assert.equal(p.data.task.state, 'done'); assert.equal(p.draft.placements.length, 0); assert.equal(p.data.count, 0);
  platform.call = async () => { throw new Error('A committed result must not show a cancellation prompt'); };
  await p.back(); p.onUnload();
  assert.equal(p.photoTask, null); assert.ok(events.includes('close')); assert.equal(f.store.board(f.date).placements.length, 0);
  assert.equal(Object.keys(f.store.get().memories).length, 1); assert.equal(f.store.get().boards[f.date], undefined);
});

test('memory close handles completion during confirmation and does not cancel the saved replacement', async t => {
  const f = fixture(t), photos = { originalPath: '/old.jpg', subjectPath: '/old.png', width: 400, height: 300, kind: 'extracted' };
  const id = f.store.add('old', f.date, photos), p = Object.assign({}, memoryDefinition, { data: clone(memoryDefinition.data), store: f.store, id,
    setData(update) { Object.assign(this.data, update); } });
  p.refresh(); let finishExtraction;
  extraction.extract = () => new Promise(resolve => { finishExtraction = resolve; });
  const processing = photo.begin(p, 'album', { date: f.date, memoryId: id }); await tick();
  let confirm, navigations = 0;
  platform.call = method => method === 'showModal' ? new Promise(resolve => { confirm = resolve; }) : Promise.resolve({ width: 400, height: 300 });
  platform.back = () => { navigations++; };
  const closing = p.back(); await p.back(); finishExtraction('/new-cutout.png'); await processing;
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

test('post-extraction caption is optional and saves on Continue without changing placement or automatic category', async t => {
  const f = fixture(t), p = f.page;
  await photo.begin(p, 'album', { date: f.date });
  const id = f.completed[0], boards = clone(f.store.get().boards);
  f.store.commit(state => { Object.assign(state.memories[id], { category: '自然', categorySource: 'auto' }); });
  photo.openNote(p); photo.inputNote(p, { detail: { value: '今天看见的小树' } });
  assert.equal(f.store.getMemoryDraft(id).text, '今天看见的小树'); assert.equal(f.guards.at(-1), true);
  assert.equal(photo.finish(p, false), true);
  assert.equal(f.store.get().memories[id].text, '今天看见的小树'); assert.equal(f.store.get().memories[id].categorySource, 'auto');
  assert.deepEqual(f.store.get().boards, boards); assert.equal(f.store.getMemoryDraft(id), undefined);
  await photo.begin(p, 'camera', { date: f.date }); assert.equal(p.data.photoNoteOpen, false); assert.equal(p.data.photoNoteText, '');
  assert.equal(photo.finish(p, false), true); assert.equal(Object.keys(f.store.get().memories).length, 2);
  assert.equal(f.store.get().memories[f.completed[1]].text, '');
});

test('caption save failure blocks completion and board flight; retry saves without duplicating the photo', async t => {
  const f = fixture(t), controller = createBoardEditor(), p = { ...controller, data: clone(controller.data), store: f.store, date: f.date, wantEdit: true,
    setData(update) { Object.assign(this.data, update); }, selectComponent() { return { touchCancel() {} }; } };
  p.refresh(); await p.album(); const id = p.photoNoteId;
  photo.openNote(p); photo.inputNote(p, { detail: { value: '稍后重试' } }); f.failSave(true);
  assert.equal(photo.finish(p, false), false); await p.continuePhoto();
  assert.equal(p.data.task.state, 'done'); assert.equal(!!p.data.placing, false); assert.ok(p.data.photoNoteError);
  assert.equal(f.store.getMemoryDraft(id).text, '稍后重试'); assert.equal(Object.keys(f.store.get().memories).length, 1);
  assert.equal(f.store.board(f.date).placements.length, 0);
  f.failSave(false); await p.continuePhoto(); assert.equal(f.store.get().memories[id].text, '稍后重试');
  assert.equal(f.store.board(f.date).placements.length, 1);
  assert.equal(p.data.task, null); assert.equal(f.store.getMemoryDraft(id), undefined);
});

test('unloading a caption retains its draft and replacing a photo can keep its existing caption', async t => {
  const f = fixture(t), p = f.page;
  await photo.begin(p, 'album', { date: f.date }); const id = p.photoNoteId;
  photo.openNote(p); photo.inputNote(p, { detail: { value: '未写完的说明' } }); await photo.dispose(p);
  assert.equal(f.store.getMemoryDraft(id).text, '未写完的说明'); assert.equal(f.store.get().memories[id].text, '');
  f.store.clearMemoryDraft(id); f.store.edit(id, '原来的说明', '自然');
  const next = { ...p, disposed: false, data: { task: null } };
  await photo.begin(next, 'album', { date: f.date, memoryId: id }); assert.equal(next.data.photoNoteText, '原来的说明');
  photo.finish(next, false); assert.equal(f.store.get().memories[id].text, '原来的说明'); assert.equal(Object.keys(f.store.get().memories).length, 1);
});

test('editing the caption while replacing a photo immediately refreshes its detail page', async t => {
  const f = fixture(t), id = f.store.add('replacement_caption', f.date, { originalPath: '/old.jpg', subjectPath: '/old.png', width: 400, height: 300 });
  const p = { ...memoryDefinition, store: f.store, id, data: clone(memoryDefinition.data), setData(update) { Object.assign(this.data, update); } };
  p.refresh(); await photo.begin(p, 'album', { date: f.date, memoryId: id });
  p.openPhotoNote(); p.photoNoteInput({ detail: { value: '替换照片时的新说明' } }); p.cancelPhoto();
  assert.equal(p.data.task, null); assert.equal(p.data.memory.text, '替换照片时的新说明'); assert.equal(p.data.text, '替换照片时的新说明');
  assert.equal(Object.keys(f.store.get().memories).length, 1);
});
