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
