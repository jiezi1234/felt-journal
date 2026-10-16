const test = require('node:test');
const assert = require('node:assert/strict');
const { fields } = require('../miniprogram/core/classification');
const { createStore } = require('../miniprogram/core/store');
const { PhotoTask } = require('../miniprogram/services/photo-task');
const extraction = require('../miniprogram/services/extraction');
const platform = require('../miniprogram/services/platform');
const config = require('../miniprogram/core/config');
const date = '2024-02-29';
const photo = { originalPath: '/original.jpg', subjectPath: '/subject.png', width: 200, height: 200, kind: 'extracted' };
function fixture() { const disk = {}; return createStore({ get: k => disk[k], set: (k, v) => { disk[k] = v; } }); }
const prediction = category => ({ category, status: 'classified', confidence: .91 });

test('only supported, confident automatic categories enter journal data', () => {
  for (const category of ['饮食', '自然', '出行', '日常']) assert.deepEqual(fields(prediction(category)), { category, categorySource: 'auto' });
  for (const result of [undefined, null, {}, prediction('心情'), prediction('unknown'),
    { ...prediction('饮食'), confidence: '0.9' }, { ...prediction('饮食'), confidence: Infinity },
    { ...prediction('饮食'), confidence: 1.1 }, { ...prediction('饮食'), confidence: .64 },
    { ...prediction('饮食'), status: 'uncertain' }]) assert.deepEqual(fields(result), { category: '未分类', categorySource: 'none' });
});

test('automatic replacement updates categories, preserving manual and legacy choices and layouts', () => {
  const store = fixture();
  const id = store.add('auto', date, { ...photo, ...fields(prediction('饮食')) });
  const before = store.board(date).placements;
  store.edit(id, '只写文字', '饮食');
  assert.equal(store.get().memories[id].categorySource, 'auto');
  store.replace('new-photo', id, { ...photo, ...fields(prediction('自然')) });
  assert.equal(store.get().memories[id].category, '自然');
  store.edit(id, '手动改为出行', '出行');
  store.replace('new-photo-again', id, { ...photo, ...fields(prediction('日常')) });
  assert.equal(store.get().memories[id].category, '出行');
  assert.equal(store.get().memories[id].categorySource, 'manual');
  assert.deepEqual(store.board(date).placements, before);
  const legacy = store.add('legacy', date, { ...photo, category: '心情' });
  store.replace('replace-legacy', legacy, { ...photo, ...fields(prediction('饮食')) });
  assert.equal(store.get().memories[legacy].category, '心情');
  const uncertain = store.add('uncertain', date, { ...photo, ...fields(prediction('饮食')) });
  store.replace('ambiguous-photo', uncertain, { ...photo, ...fields(null) });
  assert.equal(store.get().memories[uncertain].category, '未分类');
  store.load();
  assert.equal(store.get().memories[id].category, '出行');
});

test('new photo saves its category automatically; retry, missing service and fallback remain safe', async t => {
  const saved = { ...platform }, originalExtract = extraction.extract;
  t.after(() => { Object.assign(platform, saved); extraction.extract = originalExtract; });
  platform.choose = async () => ({ path: '/camera.jpg' });
  platform.persist = async (_, name) => `/saved/${name}.png`;
  platform.call = async () => ({ width: 200, height: 200 });
  platform.collect = async () => {};
  platform.unlink = async () => {};
  function taskFor(store) { return new PhotoTask({ store, date, onState() {}, onDone() {}, onCancel() {} }); }
  extraction.extract = async (_, task) => { task.classification = prediction('饮食'); return '/cutout.png'; };
  const store = fixture(), task = taskFor(store);
  const add = store.add; let attempts = 0;
  store.add = (...args) => { if (!attempts++) throw new Error('quota'); return add(...args); };
  await task.start('album'); assert.equal(task.state, 'saveError');
  await task.save(); await task.save();
  assert.equal(Object.keys(store.get().memories).length, 1);
  assert.equal(Object.values(store.get().memories)[0].category, '饮食');
  assert.equal(task.savedCategory, '饮食');
  extraction.extract = async () => '/old-backend.png';
  const old = fixture(); await taskFor(old).start('album');
  assert.equal(Object.values(old.get().memories)[0].category, '未分类');
  extraction.extract = async (_, pending) => { pending.classification = prediction('自然'); throw new Error('download failed'); };
  const fallback = fixture(), pending = taskFor(fallback); await pending.start('album'); await pending.process(true);
  assert.equal(Object.values(fallback.get().memories)[0].category, '未分类');
  assert.equal(Object.values(fallback.get().memories)[0].kind, 'original');
});

test('remote adapter accepts optional classification without requiring another photo upload', async t => {
  const before = { ...config.extraction }, originalWx = global.wx;
  t.after(() => { Object.assign(config.extraction, before); global.wx = originalWx; });
  Object.assign(config.extraction, { mode: 'remote', endpoint: 'https://felt.example/extract' });
  for (const classification of [prediction('饮食'), undefined, { status: 'unavailable' }]) {
    let uploads = 0;
    global.wx = {
      uploadFile(options) { uploads++; queueMicrotask(() => options.success({ statusCode: 200, data: JSON.stringify({ cutoutUrl: 'https://felt.example/cutouts/a.png', classification }) })); return { abort() {} }; },
      downloadFile(options) { queueMicrotask(() => options.success({ statusCode: 200, tempFilePath: '/result.png' })); return { abort() {} }; }
    };
    const task = {};
    assert.equal(await extraction.extract('/photo.jpg', task, () => {}), '/result.png');
    assert.deepEqual(task.classification, classification || null);
    assert.equal(uploads, 1);
  }
});
