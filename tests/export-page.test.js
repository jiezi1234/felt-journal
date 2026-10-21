const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const platform = require('../miniprogram/services/platform');
const renderer = require('../miniprogram/core/renderer');
let definition;
global.Page = page => { definition = page; }; require('../miniprogram/pages/export/index'); delete global.Page;
let cardDefinition;
global.Component = card => { cardDefinition = card; }; require('../miniprogram/components/share-card/index'); delete global.Component;
function fixture(t) {
  const originalPlatform = { ...platform }, originalRenderer = { ...renderer }, originalWx = global.wx;
  t.after(() => { Object.assign(platform, originalPlatform); Object.assign(renderer, originalRenderer); if (originalWx === undefined) delete global.wx; else global.wx = originalWx; });
  const calls = [], toasts = [], disk = {}; let missing = false;
  const store = createStore({ get: key => disk[key], set: (key, value) => { disk[key] = value; } }), date = dates.key();
  store.add('export_test', date, { originalPath: '/original.png', subjectPath: '/subject.png', width: 100, height: 100, kind: 'extracted' });
  const canvas = { getContext: () => ({ setTransform() {} }) };
  const selector = { select() { return this; }, fields() { return this; }, exec(callback) { callback([{ node: canvas }]); } };
  global.wx = { showShareImageMenu() {}, canIUse: () => true, createSelectorQuery: () => selector,
    getFileSystemManager: () => ({ accessSync() { if (missing) throw new Error('no such file'); } }) };
  platform.toast = text => toasts.push(text);
  platform.call = async (name, options) => { calls.push({ name, options }); return name === 'canvasToTempFilePath' ? { tempFilePath: '/new-export.png' } : {}; };
  renderer.loadImages = async () => ({}); renderer.paint = () => {};
  const page = { ...definition, store, date, data: { ...clone(definition.data), generating: false, imagePath: '/preview.png' }, setData(update) { Object.assign(this.data, update); } };
  page.refreshShareSupport();
  return { page, store, disk, date, calls, toasts, canvas, missing(value) { missing = value; } };
}

test('portrait sharing preserves screen spacing, sticker sizes and saved layout across appearance changes', async t => {
  const f = fixture(t), before = f.disk[KEY], calls = [];
  f.page.exportViewport = { width: 1500, height: 2500 };
  renderer.paint = (_, model, images, selection, dimensions) => calls.push({ model, selection, dimensions });
  await f.page.generate();
  assert.equal(f.page.data.error, ''); assert.equal(f.canvas.width, 1015); assert.equal(f.canvas.height, 1800);
  const saved = f.store.view(f.date), drawn = calls[0].model.items[0], item = saved.items[0];
  assert.equal(drawn.x, item.x); assert.equal(drawn.y, item.y * (2500 - 90) / (1000 - 90));
  for (const key of ['width', 'height', 'angle', 'z']) assert.equal(drawn[key], item[key]);
  assert.equal(calls[0].dimensions.height, 2500); assert.equal(calls[0].selection, '');
  await f.page.chooseAppearance('previewTexture', f.page.data.textures, 'cross');
  assert.deepEqual(calls[1].model.items, calls[0].model.items);
  assert.equal(f.disk[KEY], before); assert.equal(f.canvas.height, 1800);
});

test('horizontal export includes transparent clamp headroom and invalid viewports never export', async t => {
  const f = fixture(t); await f.page.generate();
  assert.deepEqual([f.canvas.width, f.canvas.height], [1800, 1392]);
  const exports = f.calls.length; f.page.exportViewport = { width: 0, height: 2500 }; await f.page.generate();
  assert.match(f.page.data.error, /尺寸/); assert.equal(f.page.data.imagePath, ''); assert.equal(f.calls.length, exports);
});
test('sharing uses the exact exported preview without app entry, storage mutation or delivery claims', async t => {
  const f = fixture(t), before = f.disk[KEY]; await f.page.shareImage();
  assert.deepEqual(f.calls, [{ name: 'showShareImageMenu', options: { path: '/preview.png', needShowEntrance: false } }]);
  assert.equal(f.page.data.sharing, false); assert.equal(f.page.data.albumSaved, false); assert.equal(f.page.data.shareError, '');
  assert.equal(f.disk[KEY], before); assert.deepEqual(f.toasts, []);
});
test('an open sharing request prevents duplicate taps, album saves and regeneration', async t => {
  const f = fixture(t); let complete, calls = 0;
  platform.call = () => { calls++; return new Promise(resolve => { complete = resolve; }); };
  const operation = f.page.shareImage(); assert.equal(f.page.data.sharing, true);
  await f.page.shareImage(); await f.page.saveAlbum(); await f.page.generate(); assert.equal(calls, 1); assert.equal(f.page.data.imagePath, '/preview.png');
  complete({}); await operation; assert.equal(f.page.data.sharing, false);
});
test('cancelling the native panel is quiet and preserves any existing album result', async t => {
  const f = fixture(t); f.page.data.albumSaved = true;
  for (const error of [{ errMsg: 'showShareImageMenu:fail cancel' }, new Error('showShareImageMenu:fail user cancel')]) {
    platform.call = async () => { throw error; }; await f.page.shareImage();
    assert.equal(f.page.data.shareError, ''); assert.equal(f.page.data.error, ''); assert.equal(f.page.data.sharing, false); assert.equal(f.page.data.albumSaved, true);
  }
  assert.deepEqual(f.toasts, []);
});
test('capability detection and runtime unsupported errors leave album saving available', async t => {
  const f = fixture(t);
  wx.canIUse = () => false; await f.page.shareImage(); assert.equal(f.page.data.shareSupported, false); assert.equal(f.calls.length, 0);
  wx.canIUse = () => true; delete wx.showShareImageMenu; await f.page.shareImage(); assert.equal(f.calls.length, 0);
  wx.showShareImageMenu = () => {};
  platform.call = async () => { throw { errMsg: 'showShareImageMenu:fail not supported' }; };
  await f.page.shareImage(); assert.equal(f.page.data.shareSupported, false); assert.equal(f.page.data.shareError, ''); assert.equal(f.page.data.sharing, false);
  platform.call = async () => ({}); await f.page.saveAlbum(); assert.equal(f.page.data.albumSaved, true);
});
test('sharing failure can retry while retaining independent album permission feedback', async t => {
  const f = fixture(t); f.page.data.albumDenied = true; f.page.data.error = '相册权限未开启';
  platform.call = async () => { throw { errMsg: 'showShareImageMenu:fail internal error' }; };
  await f.page.shareImage(); assert.match(f.page.data.shareError, /重试/); assert.equal(f.page.data.shareSupported, true); assert.equal(f.page.data.sharing, false);
  assert.equal(f.page.data.error, '相册权限未开启'); assert.equal(f.page.data.albumDenied, true);
  platform.call = async () => ({}); await f.page.shareImage(); assert.equal(f.page.data.shareError, ''); assert.equal(f.page.data.albumSaved, false);
});
test('expired exports block share/save and can regenerate from the unchanged board', async t => {
  const f = fixture(t), before = f.disk[KEY]; f.missing(true);
  await f.page.shareImage(); await f.page.saveAlbum(); assert.equal(f.calls.length, 0); assert.equal(f.page.data.imageExpired, true); assert.match(f.page.data.error, /重新生成/);
  f.missing(false); await f.page.generate(); assert.equal(f.page.data.imagePath, '/new-export.png'); assert.equal(f.page.data.imageExpired, false); assert.equal(f.page.data.error, '');
  assert.deepEqual([f.canvas.width, f.canvas.height], [1800, 1392]); assert.equal(f.page.data.count, 1);
  await f.page.shareImage(); assert.equal(f.calls.at(-1).options.path, '/new-export.png'); assert.equal(f.disk[KEY], before);
});
test('late share and album callbacks do not update or toast on an unloaded page', async t => {
  for (const action of ['shareImage', 'saveAlbum']) {
    const f = fixture(t); let complete;
    platform.call = () => new Promise(resolve => { complete = resolve; });
    const operation = f.page[action](); f.page.onUnload(); const before = clone(f.page.data);
    complete({}); await operation; assert.deepEqual(f.page.data, before); assert.deepEqual(f.toasts, []);
    await f.page[action](); assert.deepEqual(f.page.data, before);
  }
});
test('album denial, retry and success are independent from opening the share panel', async t => {
  const f = fixture(t);
  platform.call = async () => { throw { errMsg: 'saveImageToPhotosAlbum:fail auth denied' }; };
  await f.page.saveAlbum(); assert.equal(f.page.data.albumDenied, true); assert.equal(f.page.data.albumSaved, false); assert.equal(f.page.data.saving, false);
  platform.call = async () => ({}); await f.page.shareImage(); assert.equal(f.page.data.albumSaved, false);
  await f.page.saveAlbum(); assert.equal(f.page.data.albumDenied, false); assert.equal(f.page.data.albumSaved, true); assert.equal(f.page.data.error, '');
  assert.deepEqual(f.toasts, ['已保存到相册']);
});
test('unfinished or empty export states cannot open the panel or save an image', async t => {
  const f = fixture(t);
  for (const state of [{ generating: true }, { saving: true }, { imageExpired: true }, { imagePath: '' }]) {
    Object.assign(f.page.data, { generating: false, saving: false, imageExpired: false, imagePath: '/preview.png' }, state);
    await f.page.shareImage(); await f.page.saveAlbum(); assert.equal(f.calls.length, 0);
  }
});
test('unsaved layouts, empty boards and failed image reads do not expose a shareable image', async t => {
  const f = fixture(t); f.store.keepDraft(f.store.board(f.date)); await f.page.generate();
  assert.equal(f.page.data.imagePath, ''); assert.match(f.page.data.error, /未保存/);
  f.store.clearDraft(f.date); renderer.loadImages = async () => { throw new Error('照片文件缺失'); }; await f.page.generate();
  assert.equal(f.page.data.imagePath, ''); assert.match(f.page.data.error, /缺失/);
  f.store.remove('m_export_test'); await f.page.generate(); assert.match(f.page.data.error, /空板/);
  await f.page.shareImage(); assert.equal(f.calls.length, 0);
});
test('theme exports use the selected theme layout/name and reject a deleted theme', async t => {
  const f = fixture(t), id = f.store.createTheme('export', '一季的收藏', 'm_export_test'); f.page.date = id;
  await f.page.generate(); assert.equal(f.page.data.imagePath, '/new-export.png'); assert.equal(f.page.data.dateLabel, '一季的收藏'); assert.equal(f.page.data.isTheme, true);
  f.store.deleteTheme(id); await f.page.generate(); assert.equal(f.page.data.imagePath, ''); assert.match(f.page.data.error, /已被删除/);
});
test('share appearance regenerates the preview without changing saved boards or placements', async t => {
  const f = fixture(t), before = f.disk[KEY], paints = [];
  renderer.paint = (_, model) => paints.push(clone(model));
  await f.page.generate();
  await f.page.chooseColor({ currentTarget: { dataset: { value: '#C3D0BD' } } });
  await f.page.chooseTexture({ currentTarget: { dataset: { value: 'cross' } } });
  assert.equal(paints.at(-1).color, '#C3D0BD'); assert.equal(paints.at(-1).texture, 'cross');
  assert.equal(f.disk[KEY], before);
  assert.deepEqual(paints[0].items, paints.at(-1).items);
  const count = paints.length;
  await f.page.chooseColor({ currentTarget: { dataset: { value: 'invalid' } } });
  f.page.data.sharing = true; await f.page.chooseTexture({ currentTarget: { dataset: { value: 'fine' } } });
  assert.equal(paints.length, count);
});

test('share card uses its own canvas scope and closes its style drawer before the card', async t => {
  const f = fixture(t), events = [], query = wx.createSelectorQuery();
  Object.assign(f.page, cardDefinition.methods, { triggerEvent: name => events.push(name), createSelectorQuery: () => query });
  wx.createSelectorQuery = () => { throw Error('Page-scoped query must not be used inside the card'); };
  await f.page.generate(); assert.equal(f.page.data.error, ''); assert.equal(f.page.data.imagePath, '/new-export.png');
  const before = f.disk[KEY];
  f.page.openAppearance(); assert.equal(f.page.data.styleOpen, true);
  f.page.back(); assert.equal(f.page.data.styleOpen, false); assert.deepEqual(events, []);
  f.page.back(); assert.deepEqual(events, ['close']); assert.equal(f.disk[KEY], before);
  f.page.close(); assert.deepEqual(events, ['close']);
});

test('closing a generating share card prevents late updates and export work', async t => {
  const f = fixture(t), events = []; let finish;
  Object.assign(f.page, cardDefinition.methods, { triggerEvent: name => events.push(name) });
  renderer.loadImages = () => new Promise(resolve => { finish = resolve; });
  const generating = f.page.generate(); await Promise.resolve();
  f.page.close(); const before = clone(f.page.data);
  finish({}); await generating;
  assert.deepEqual(events, ['close']); assert.deepEqual(f.page.data, before); assert.deepEqual(f.calls, []);
});

test('native share and album requests keep the share card mounted until they finish', async t => {
  for (const action of ['shareImage', 'saveAlbum']) {
    const f = fixture(t), events = []; let finish;
    Object.assign(f.page, cardDefinition.methods, { triggerEvent: name => events.push(name) });
    platform.call = () => new Promise(resolve => { finish = resolve; });
    const operation = f.page[action](); f.page.close(); assert.deepEqual(events, []);
    finish({}); await operation; f.page.close(); assert.deepEqual(events, ['close']);
  }
});
