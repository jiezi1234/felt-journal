const test = require('node:test');
const assert = require('node:assert/strict');
const extraction = require('../miniprogram/services/extraction');
const config = require('../miniprogram/services/extraction-config');

function setup(t, local = true) {
  const originalWx = global.wx, originalResolve = config.resolve;
  t.after(() => { global.wx = originalWx; config.resolve = originalResolve; });
  const origin = local ? 'http://127.0.0.1:8788' : 'https://felt.example';
  config.resolve = () => ({ local, mode: 'remote', endpoint: origin + '/extract', origin, timeout: 60000 });
  global.wx = {};
  return origin;
}

test('stopped local upload service shows a service connection error and never downloads a fake result', async t => {
  setup(t); let downloaded = false;
  global.wx.uploadFile = options => { queueMicrotask(() => options.fail({ errMsg: 'uploadFile:fail net::ERR_CONNECTION_REFUSED' })); return { abort() {} }; };
  global.wx.downloadFile = () => { downloaded = true; };
  await assert.rejects(extraction.extract('/photo.jpg', {}, () => {}), /无法连接本机抠图服务/);
  assert.equal(downloaded, false);
});

test('local timeout and a service stopping during download have distinct recoverable errors', async t => {
  const origin = setup(t);
  global.wx.uploadFile = options => { queueMicrotask(() => options.fail({ errMsg: 'uploadFile:fail timeout' })); return { abort() {} }; };
  await assert.rejects(extraction.extract('/photo.jpg', {}, () => {}), /响应超时/);
  global.wx.uploadFile = options => { queueMicrotask(() => options.success({ statusCode: 200, data: JSON.stringify({ cutoutUrl: origin + '/cutouts/' + 'a'.repeat(32) + '.png' }) })); return { abort() {} }; };
  global.wx.downloadFile = options => { queueMicrotask(() => options.fail({ errMsg: 'downloadFile:fail net::ERR_CONNECTION_REFUSED' })); return { abort() {} }; };
  await assert.rejects(extraction.extract('/photo.jpg', {}, () => {}), /无法连接本机抠图服务/);
});

test('user cancellation is not reported as a stopped local service', async t => {
  setup(t);
  global.wx.uploadFile = options => ({ abort() { options.fail({ errMsg: 'uploadFile:fail abort' }); } });
  const task = {}, result = extraction.extract('/photo.jpg', task, () => {});
  task.cancelled = true; task.abort(); await assert.rejects(result, /处理已取消/); assert.equal(task.abort, null);
});

test('HTTPS failures preserve their original reason without local-service instructions', async t => {
  setup(t, false); const reason = { errMsg: 'uploadFile:fail url not in domain list' };
  global.wx.uploadFile = options => { queueMicrotask(() => options.fail(reason)); return { abort() {} }; };
  await assert.rejects(extraction.extract('/photo.jpg', {}, () => {}), error => error === reason);
});

test('server development authenticates both upload and download and keeps classification', async t => {
  setup(t, false);
  const origin = 'http://192.0.2.10', header = { Authorization: 'Bearer ' + 'd'.repeat(43) };
  config.resolve = () => ({ mode: 'remote', endpoint: origin + '/extract', origin, developmentServer: true, header });
  const classification = { category: 'food', status: 'classified' };
  global.wx.uploadFile = options => {
    assert.deepEqual(options.header, header);
    queueMicrotask(() => options.success({ statusCode: 200, data: JSON.stringify({ cutoutUrl: origin + '/cutouts/' + 'a'.repeat(32) + '.png', classification }) }));
    return { abort() {} };
  };
  global.wx.downloadFile = options => {
    assert.deepEqual(options.header, header);
    queueMicrotask(() => options.success({ statusCode: 200, tempFilePath: '/result.png' })); return { abort() {} };
  };
  const task = {}; assert.equal(await extraction.extract('/photo.jpg', task, () => {}), '/result.png'); assert.deepEqual(task.classification, classification);
  global.wx.uploadFile = options => { queueMicrotask(() => options.success({ statusCode: 401 })); return { abort() {} }; };
  await assert.rejects(extraction.extract('/photo.jpg', {}, () => {}), /凭证已失效/);
  global.wx.uploadFile = options => { queueMicrotask(() => options.fail({ errMsg: 'connection refused' })); return { abort() {} }; };
  await assert.rejects(extraction.extract('/photo.jpg', {}, () => {}), /无法连接抠图服务器/);
});
