const test = require('node:test');
const assert = require('node:assert/strict');
const service = require('../miniprogram/services/extraction-config');
const config = require('../miniprogram/core/config');
test('local service is opt-in, loopback-only, DevTools develop-only', t => {
  const original = global.wx; t.after(() => { global.wx = original; });
  for (const platform of ['ios', 'android', 'devtools']) for (const env of ['develop', 'trial', 'release']) {
    global.wx = { getSystemInfoSync: () => ({ platform }), getAccountInfoSync: () => ({ miniProgram: { envVersion: env } }), getStorageSync: () => 'http://127.0.0.1:8787/extract' };
    const resolved = service.resolve();
    assert.equal(resolved.local, platform === 'devtools' && env === 'develop');
    if (!resolved.local) assert.equal(resolved.endpoint, config.extraction.endpoint);
  }
  for (const endpoint of ['', 'http://example.com/extract', 'http://127.0.0.1:0/extract', 'http://127.0.0.1:99999/extract', 'http://127.0.0.1:8787/extract?redirect=evil', 'http://127.0.0.1:8787/other']) {
    global.wx.getAccountInfoSync = () => ({ miniProgram: { envVersion: 'develop' } });
    global.wx.getStorageSync = () => endpoint; assert.equal(service.resolve().local, false);
  }
});
test('local download cannot escape the same loopback origin or token path', () => {
  const local = { local: true, origin: 'http://127.0.0.1:8787' };
  assert.ok(service.acceptsResult('http://127.0.0.1:8787/cutouts/' + 'a'.repeat(32) + '.png', local));
  for (const url of ['http://evil/cutouts/abc.png', 'http://127.0.0.1:8787/cutouts/../secrets', 'http://127.0.0.1:8787/cutouts/' + 'a'.repeat(32) + '.png?redirect=evil', 'https://127.0.0.1:8787/cutouts/' + 'a'.repeat(32) + '.png']) assert.equal(service.acceptsResult(url, local), false);
  assert.equal(service.acceptsResult('http://127.0.0.1:8787/cutouts/a.png', { local: false }), false);
});
test('local preview rejects older extractors without textured sticker support', () => {
  assert.equal(service.supportsLocalStickers({ status: 'ok', model: 'isnet-general-use', modelLoaded: true }), false);
  assert.equal(service.supportsLocalStickers({ status: 'ok', model: 'nosh-mnn', modelLoaded: true }), false);
  assert.equal(service.supportsLocalStickers({ status: 'ok', model: 'nosh-mnn', stickerStyle: 'nosh-white-v1', modelLoaded: true }), false);
  assert.equal(service.supportsLocalStickers({ status: 'ok', model: 'nosh-mnn', stickerStyle: 'nosh-textured-v2', modelLoaded: false }), true);
  assert.equal(service.supportsLocalStickers(null), false);
});

test('published clients use WeChat sessions and restrict downloads to the configured service', t => {
  const original = global.wx; t.after(() => { global.wx = original; });
  for (const envVersion of ['trial', 'release']) {
    global.wx = { getSystemInfoSync: () => ({ platform: 'android' }), getAccountInfoSync: () => ({ miniProgram: { envVersion } }),
      getStorageSync: () => { throw Error('Published versions must not read development tokens'); } };
    const c = service.resolve();
    assert.equal(c.auth, 'wechat'); assert.equal(c.mode, 'remote'); assert.equal(c.header, undefined);
    assert.equal(c.origin, 'https://api.jiejiezi.cn');
    assert.ok(service.acceptsResult(c.origin + '/cutouts/' + 'a'.repeat(32) + '.png', c));
    for (const url of ['https://evil.example/cutouts/' + 'a'.repeat(32) + '.png', c.origin + '/cutouts/../secret',
      c.origin + '/cutouts/' + 'a'.repeat(32) + '.png?redirect=evil']) assert.equal(service.acceptsResult(url, c), false);
  }
});

test('server development requires explicit credentials and is ignored in trial/release', t => {
  const original = global.wx; t.after(() => { global.wx = original; });
  const value = { endpoint: 'http://192.0.2.10/extract', token: 'd'.repeat(43) };
  for (const platform of ['ios', 'android', 'devtools']) for (const env of ['develop', 'trial', 'release']) {
    global.wx = { getSystemInfoSync: () => ({ platform }), getAccountInfoSync: () => ({ miniProgram: { envVersion: env } }),
      getStorageSync: key => key === service.SERVER_DEVELOPMENT_KEY ? value : '' };
    const resolved = service.resolve();
    assert.equal(!!resolved.developmentServer, env === 'develop');
    assert.equal(resolved.local, false);
    if (env === 'develop') {
      assert.equal(resolved.header.Authorization, 'Bearer ' + value.token);
      assert.ok(service.acceptsResult('http://192.0.2.10/cutouts/' + 'a'.repeat(32) + '.png', resolved));
      for (const url of ['http://192.0.2.11/cutouts/' + 'a'.repeat(32) + '.png', 'https://evil.example/a.png', 'http://192.0.2.10/cutouts/../secret']) assert.equal(service.acceptsResult(url, resolved), false);
    } else { assert.equal(resolved.endpoint, config.extraction.endpoint); assert.equal(resolved.header, undefined); }
  }
  for (const endpoint of ['http://evil.example/extract', 'http://192.0.2.10:99999/extract', 'http://192.0.2.10/extract?x=1', 'http://256.0.0.1/extract', 'http://127.0.0.1:8788/extract', 'http://192.0.2.01/extract']) {
    assert.equal(service.validServerDevelopment({ ...value, endpoint }), false);
  }
  assert.equal(service.validServerDevelopment({ ...value, token: '' }), false);
});

test('HTTPS development keeps credentials on the exact domain and ignores trial/release', t => {
  const original = global.wx; t.after(() => { global.wx = original; });
  const origin = 'https://api.felt.example';
  const value = { endpoint: origin + '/extract', token: 'd'.repeat(43) };
  for (const platform of ['ios', 'android', 'devtools']) for (const env of ['develop', 'trial', 'release']) {
    global.wx = { getSystemInfoSync: () => ({ platform }), getAccountInfoSync: () => ({ miniProgram: { envVersion: env } }),
      getStorageSync: key => key === service.SERVER_DEVELOPMENT_KEY ? value : '' };
    const resolved = service.resolve();
    assert.equal(!!resolved.developmentServer, env === 'develop');
    if (env !== 'develop') { assert.equal(resolved.header, undefined); continue; }
    assert.equal(resolved.endpoint, value.endpoint);
    assert.equal(resolved.header.Authorization, 'Bearer ' + value.token);
    const suffix = '/cutouts/' + 'a'.repeat(32) + '.png';
    assert.ok(service.acceptsResult(origin + suffix, resolved));
    for (const other of ['http://api.felt.example', 'https://api.felt.example.evil.example', 'https://evil.example', origin + ':443']) {
      assert.equal(service.acceptsResult(other + suffix, resolved), false);
    }
    assert.equal(service.acceptsResult(origin + suffix + '?redirect=evil', resolved), false);
  }
  for (const endpoint of ['https://localhost/extract', 'https://192.0.2.10/extract', 'https://api.felt.example:443/extract',
    'https://user@api.felt.example/extract', 'https://api.felt.example/extract?x=1', 'https://api.felt.example/extract#x',
    'https://-api.felt.example/extract', 'https://api..example/extract', 'https://api_.example/extract',
    'https://' + 'a'.repeat(64) + '.example/extract', 'https://api.felt.example/../extract']) {
    assert.equal(service.validServerDevelopment({ ...value, endpoint }), false, endpoint);
  }
});
