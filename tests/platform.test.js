const test = require('node:test');
const assert = require('node:assert/strict');
const platform = require('../miniprogram/services/platform');
test('file cleanup rejects traversal and files outside its own generated namespace', async t => {
  const original = global.wx, deleted = [];
  t.after(() => { global.wx = original; });
  global.wx = { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => ({ unlink(options) { deleted.push(options.filePath); options.success({}); } }) };
  for (const path of ['/user/photo.jpg', '/user/felt-journal/../photo.jpg', '/user/felt-journal/unknown.png', '/user/felt-journal/sub/folder.png']) await platform.unlink(path);
  assert.deepEqual(deleted, []);
  await platform.unlink('/user/felt-journal/abc_1_def_original.jpg'); assert.deepEqual(deleted, ['/user/felt-journal/abc_1_def_original.jpg']);
});

test('object deletion dialog offers explicit confirmation and respects cancel', async t => {
  const original = global.wx, dialogs = [];
  t.after(() => { global.wx = original; });
  let confirm = false;
  global.wx = { showModal(options) { dialogs.push(options); options.success({ confirm, cancel: !confirm }); } };
  assert.equal(await platform.confirmRemovePlacement(), false);
  confirm = true; assert.equal(await platform.confirmRemovePlacement(), true);
  assert.equal(dialogs[0].title, '是否删除该部件？'); assert.equal(dialogs[0].confirmText, '确定'); assert.equal(dialogs[0].cancelText, '取消');
  assert.match(dialogs[0].content, /当前毛毡板/); assert.match(dialogs[0].content, /会保留/);
});
