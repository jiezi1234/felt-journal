const test = require('node:test');
const assert = require('node:assert/strict');
const { createThemeBoardPage } = require('../miniprogram/services/theme-board-page');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const platform = require('../miniprogram/services/platform');
const extraction = require('../miniprogram/services/extraction');
const dates = require('../miniprogram/core/date');
const config = require('../miniprogram/core/config');
const tick = () => new Promise(resolve => setImmediate(resolve));
const event = id => ({ currentTarget: { dataset: { id } } });
const photos = { originalPath: '/original.jpg', subjectPath: '/subject.png', width: 400, height: 300 };

function fixture(t) {
  const original = { ...platform }, originalExtract = extraction.extract, originalDate = dates.key;
  t.after(() => { Object.assign(platform, original); extraction.extract = originalExtract; dates.key = originalDate; });
  const disk = {}, sources = [], removed = [], navigation = []; let failing = false, extractions = 0;
  const store = createStore({ get: key => disk[key], set(key, value) { if (failing && key === KEY) throw new Error('quota exceeded'); disk[key] = value; } });
  const theme = store.createTheme('photo_target', '旅行'), other = store.createTheme('photo_other', '美食');
  const definition = createThemeBoardPage(), tab = { data: {}, setData(value) { Object.assign(this.data, value); } };
  const page = { ...definition, data: clone(definition.data), store, activeThemeId: theme, memoryId: '', getTabBar: () => tab, setData(value) { Object.assign(this.data, value); } };
  platform.choose = async source => { sources.push(source); return { path: '/tmp/photo.jpg' }; };
  platform.persist = async (_, name) => `/saved/${name}.png`; platform.unlink = async file => removed.push(file);
  platform.collect = async () => {}; platform.localNotice = async () => {}; platform.unloadGuard = () => {}; platform.toast = () => {};
  platform.call = async (method, options) => { if (method !== 'getImageInfo') navigation.push({ method, options }); return { width: 400, height: 300 }; };
  extraction.extract = async (_, task) => { extractions++; task.classification = { status: 'classified', category: '饮食', confidence: 0.99 }; return '/tmp/cutout.png'; };
  page.onShow();
  return { page, store, disk, sources, removed, navigation, tab, theme, other, fail(value) { failing = value; }, extractions: () => extractions };
}

test('camera and album create photos directly on a theme, without daily placements or navigation', async t => {
  const f = fixture(t), p = f.page;
  const dailyId = f.store.add('existing_daily', dates.key(), photos), daily = f.store.board(dates.key());
  const other = f.store.board(f.other);
  for (const source of ['camera', 'album']) {
    await p.sourceSheet(); assert.equal(p.data.drawer, 'source'); assert.equal(f.tab.data.hidden, true);
    await p[source](); assert.equal(p.data.task.state, 'done'); assert.equal(p.data.task.kind, 'extracted');
    assert.equal(p.data.editable, true); assert.equal(p.data.selected, '');
    const id = p.photoNoteId; assert.notEqual(id, dailyId);
    assert.equal(f.store.get().memories[id].date, dates.key()); assert.equal(f.store.get().memories[id].category, '饮食');
    assert.deepEqual(f.store.boardsForMemory(id), []);
    assert.equal(f.tab.data.hidden, true); await p.continuePhoto(); assert.equal(f.tab.data.hidden, false);
    assert.equal(p.data.selected, id);
    assert.deepEqual(f.store.boardsForMemory(id).map(b => b.id), [f.theme]);
  }
  assert.deepEqual(f.sources, ['camera', 'album']); assert.equal(p.data.count, 2);
  assert.deepEqual(f.store.board(dates.key()), daily); assert.deepEqual(f.store.board(f.other), other); assert.deepEqual(f.navigation, []);
});

test('permission retry preserves the original theme target and restores navigation on selection cancellation', async t => {
  const f = fixture(t), p = f.page; let attempts = 0;
  platform.choose = async () => { if (!attempts++) throw { errMsg: 'chooseMedia:fail auth denied' }; return { path: '/tmp/photo.jpg' }; };
  await p.sourceSheet(); await p.camera(); assert.equal(p.data.task.state, 'sourceError'); assert.equal(p.data.task.permission, true);
  p.open(event(f.other)); assert.equal(p.date, f.theme);
  await p.retryPhoto(); assert.equal(p.data.task.state, 'done'); assert.equal(f.store.board(f.theme).placements.length, 0);
  assert.equal(f.store.get().boards[dates.key()], undefined); await p.continuePhoto();
  assert.equal(f.store.board(f.theme).placements.length, 1);
  platform.choose = async () => { throw { errMsg: 'chooseMedia:fail cancel' }; };
  await p.sourceSheet(); await p.album(); assert.equal(p.data.task, null); assert.equal(f.tab.data.hidden, false);
  assert.equal(Object.keys(f.store.get().memories).length, 1);
});

test('photo processing locks the target and cancellation discards late extraction without creating a record', async t => {
  const f = fixture(t), p = f.page, before = f.disk[KEY]; let finish;
  extraction.extract = () => new Promise(resolve => { finish = resolve; });
  await p.sourceSheet(); const running = p.camera(); await tick();
  await p.album(); p.next(); p.open(event(f.other)); p.create(); await p.removeTheme();
  assert.equal(p.date, f.theme); assert.equal(p.data.formOpen, false); assert.deepEqual(f.sources, ['camera']);
  await p.cancelPhoto(); finish('/tmp/late.png'); await running;
  assert.equal(f.disk[KEY], before); assert.equal(p.data.task, null); assert.equal(f.tab.data.hidden, false); assert.equal(f.removed.length, 1);
});

test('failed extraction allows explicit original fallback and save retry commits the theme photo only once', async t => {
  const f = fixture(t), p = f.page, before = f.disk[KEY];
  extraction.extract = async () => { throw new Error('offline'); };
  await p.sourceSheet(); await p.album(); assert.equal(p.data.task.state, 'extractError'); assert.equal(f.disk[KEY], before);
  f.fail(true); await p.originalPhoto(); assert.equal(p.data.task.state, 'saveError'); assert.equal(f.disk[KEY], before);
  f.fail(false); await p.retryPhoto(); await p.retryPhoto();
  assert.equal(p.data.task.kind, 'original'); assert.equal(p.data.count, 0); assert.equal(Object.keys(f.store.get().memories).length, 1);
  assert.equal(f.store.get().boards[dates.key()], undefined); await p.continuePhoto(); assert.equal(f.tab.data.hidden, false);
  assert.equal(p.data.count, 1);
});

test('theme upload pins its date at start and landing feedback never duplicates a memory', async t => {
  const f = fixture(t), p = f.page, started = dates.key(); let finish;
  extraction.extract = () => new Promise(resolve => { finish = resolve; });
  await p.sourceSheet(); const running = p.camera(); await tick(); dates.key = () => '2099-01-02'; finish('/tmp/cutout.png'); await running;
  assert.equal(f.store.get().memories[p.photoNoteId].date, started);
  p.continuePhoto({ detail: { rect: { left: 20, top: 100, width: 280, height: 220 } } });
  const before = f.disk[KEY];
  t.after(() => clearTimeout(p.placementTimer));
  const token = p.data.placing.token; p.stickerLifted({ detail: { token } });
  assert.equal(p.data.task, null); assert.equal(f.tab.data.hidden, true);
  p.stickerLanded({ detail: { token } }); assert.equal(p.data.placing, null); assert.equal(f.tab.data.hidden, false);
  assert.equal(f.disk[KEY], before); assert.equal(p.data.count, 1);
});

test('a deleted or full target rejects new photo and placement atomically instead of adding to today', t => {
  const f = fixture(t), today = dates.key(); f.store.deleteTheme(f.theme);
  let before = f.disk[KEY];
  assert.throws(() => f.store.add('missing', today, photos, f.theme), /已被删除/); assert.equal(f.disk[KEY], before);
  for (let i = 0; i < config.maxItems; i++) f.store.add('full_' + i, today, photos, f.other);
  before = f.disk[KEY]; assert.throws(() => f.store.add('overflow', today, photos, f.other), /最多/); assert.equal(f.disk[KEY], before);
  assert.equal(f.store.get().boards[today], undefined);
  const saved = f.store.add('full_0', today, photos, f.other); assert.equal(saved, 'm_full_0'); assert.equal(f.disk[KEY], before);
});
