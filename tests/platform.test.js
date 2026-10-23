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

test('startup preserves photos when the record snapshot is empty or incomplete', async t => {
  const original = global.wx;
  t.after(() => { global.wx = original; });
  const calls = [];
  global.wx = { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => ({
    readdir(options) { calls.push('readdir'); options.success({ files: ['abc_1_def_original.jpg'] }); },
    unlink(options) { calls.push('unlink'); options.success({}); }
  }) };
  for (const memories of [{}, { other: { id: 'other' } }]) {
    await platform.sweepUnused({ get: () => ({ memories, garbage: [] }), referenced: () => false });
  }
  assert.deepEqual(calls, [], 'Missing references must not authorize deletion or directory sweeping');
});

test('startup retries explicit deletions while preserving references, failed deletions and untracked files', async t => {
  const original = global.wx;
  t.after(() => { global.wx = original; });
  const doomed = '/user/felt-journal/abc_1_def_original.jpg';
  const referenced = '/user/felt-journal/abc_2_def_original.jpg';
  const failed = '/user/felt-journal/abc_3_def_original.jpg';
  const untracked = '/user/felt-journal/abc_4_def_original.jpg';
  const files = new Set([doomed, referenced, failed, untracked]), attempts = [];
  const state = { garbage: [doomed, referenced, failed] };
  global.wx = { env: { USER_DATA_PATH: '/user' }, getFileSystemManager: () => ({
    readdir() { assert.fail('Do not enumerate recoverable photos'); },
    unlink(options) {
      attempts.push(options.filePath);
      if (options.filePath === failed) options.fail({ errMsg: 'busy' });
      else { files.delete(options.filePath); options.success({}); }
    },
    accessSync(file) { if (!files.has(file)) throw Error('missing'); }
  }) };
  await platform.sweepUnused({ get: () => state, referenced: file => file === referenced, commit: fn => fn(state) });
  assert.deepEqual(attempts, [doomed, failed]);
  assert.deepEqual(state.garbage, [referenced, failed]);
  assert.deepEqual([...files], [referenced, failed, untracked]);
});
