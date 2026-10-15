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
