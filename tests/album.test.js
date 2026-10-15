const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../miniprogram/services/platform');
let definition;
global.Page = page => { definition = page; };
require('../miniprogram/pages/export/index');
delete global.Page;
function page(t) {
  const originalWx = global.wx;
  global.wx = { getFileSystemManager: () => ({ accessSync() {} }) };
  t.after(() => { if (originalWx === undefined) delete global.wx; else global.wx = originalWx; });
  return Object.assign({}, definition, { data: { ...definition.data, generating: false, imagePath: '/generated.png' }, setData(update) { Object.assign(this.data, update); } });
}
test('album write is pending until success, and duplicate taps produce only one call', async t => {
  const original = { ...platform }; t.after(() => Object.assign(platform, original));
  let finish, calls = 0; platform.call = () => { calls++; return new Promise(r => { finish = r; }); }; platform.toast = () => {};
  const p = page(t), pending = p.saveAlbum(); await p.saveAlbum();
  assert.equal(calls, 1); assert.equal(p.data.saving, true); assert.equal(p.data.albumSaved, false);
  finish({}); await pending; assert.equal(p.data.albumSaved, true); assert.equal(p.data.saving, false);
});
test('album denial preserves generated work, settings and retry can succeed', async t => {
  const original = { ...platform }; t.after(() => Object.assign(platform, original));
  platform.call = async () => { throw { errMsg: 'saveImageToPhotosAlbum:fail auth deny' }; }; platform.toast = () => {};
  const p = page(t); await p.saveAlbum();
  assert.equal(p.data.albumSaved, false); assert.equal(p.data.albumDenied, true); assert.equal(p.data.imagePath, '/generated.png'); assert.match(p.data.error, /权限/);
  const calls = []; platform.call = async name => { calls.push(name); return {}; };
  await p.settings(); await p.saveAlbum(); assert.equal(p.data.albumSaved, true); assert.equal(p.data.error, ''); assert.deepEqual(calls, ['openSetting', 'saveImageToPhotosAlbum']);
});
test('album failure never reports saved and can be retried without regenerating', async t => {
  const original = { ...platform }; t.after(() => Object.assign(platform, original));
  platform.call = async () => { throw { errMsg: 'saveImageToPhotosAlbum:fail disk full' }; }; platform.toast = () => {};
  const p = page(t); await p.saveAlbum(); assert.equal(p.data.albumSaved, false); assert.equal(p.data.albumDenied, false); assert.equal(p.data.imagePath, '/generated.png');
  assert.match(p.data.error, /未保存/); platform.call = async () => ({}); await p.saveAlbum(); assert.equal(p.data.albumSaved, true);
});
