const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { configure } = require('../scripts/server-extraction');
const { DEVELOPMENT_KEY, SERVER_DEVELOPMENT_KEY } = require('../miniprogram/services/extraction-config');
const value = { endpoint: 'http://192.0.2.10/extract', token: 'd'.repeat(43) };
const source = fs.readFileSync(path.resolve(__dirname, '../miniprogram/services/extraction-config.js'), 'utf8');

function device(options = {}) {
  const state = { platform: 'devtools', environment: 'develop', requests: 0, writes: 0, remoteCalls: 0, ...options };
  const storage = new Map([['felt-journal:v1', 'keep-journal'], [DEVELOPMENT_KEY, 'http://127.0.0.1:8787/extract']]);
  const logs = [];
  const wx = {
    getSystemInfoSync: () => ({ platform: state.platform }),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: state.environment } }),
    getStorageSync: key => storage.get(key) || '',
    setStorageSync: (key, data) => { state.writes++; storage.set(key, data); },
    removeStorageSync: key => { state.writes++; storage.delete(key); },
    request: args => {
      state.requests++;
      assert.equal(args.header.Authorization, `Bearer ${value.token}`);
      assert.equal(args.data, '');
      if (state.networkError) args.fail({ errMsg: 'network failure' });
      else args.success({ statusCode: state.status || 415 });
      if (state.disconnectAfterProbe) state.platform = 'devtools';
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(source, { module, wx, require: () => ({ extraction: { mode: 'unconfigured', endpoint: '' } }) });
  const mini = {
    remote: async () => { state.remoteCalls++; if (state.neverConnect) await new Promise(() => {}); state.platform = state.remotePlatform || 'android'; },
    evaluate: (fn, ...args) => vm.runInNewContext(`(${fn.toString()})(...args)`, {
      args, wx, require: () => state.brokenResolver ? { resolve: () => ({}) } : module.exports
    })
  };
  return { state, storage, logs, mini, run: extra => configure(mini, { value, log: line => logs.push(line), ...extra }) };
}

test('phone setup waits for the remote runtime, verifies auth and config, preserves journal, and never logs credentials', async () => {
  for (const platform of ['ios', 'android']) {
    const d = device({ remotePlatform: platform });
    const result = await d.run({ phone: true });
    assert.equal(result.platform, platform);
    assert.equal(d.state.remoteCalls, 1); assert.equal(d.state.requests, 1);
    assert.deepEqual(d.storage.get(SERVER_DEVELOPMENT_KEY), value);
    assert.equal(d.storage.has(DEVELOPMENT_KEY), false);
    assert.equal(d.storage.get('felt-journal:v1'), 'keep-journal');
    assert.ok(d.logs.some(line => line.includes(`手机（${platform}）`)));
    assert.ok(!JSON.stringify({ result, logs: d.logs }).includes(value.token));
  }
});

test('simulator setup clearly identifies its scope and does not claim a phone connection', async () => {
  const d = device(); await d.run();
  assert.equal(d.state.remoteCalls, 0);
  assert.ok(d.logs.some(line => line.includes('仅保存在模拟器')));
});

test('HTTPS setup probes and saves the protected domain without changing journal records', async () => {
  const d = device();
  const secure = { ...value, endpoint: 'https://api.felt.example/extract' };
  await d.run({ value: secure });
  assert.equal(d.state.requests, 1);
  assert.deepEqual(d.storage.get(SERVER_DEVELOPMENT_KEY), secure);
  assert.equal(d.storage.get('felt-journal:v1'), 'keep-journal');
  assert.ok(!JSON.stringify(d.logs).includes(secure.token));
});

test('phone setup never writes to a simulator, trial, release, or disconnected runtime', async () => {
  for (const options of [{ remotePlatform: 'devtools' }, { environment: 'trial' }, { environment: 'release' }, { disconnectAfterProbe: true }]) {
    const d = device(options);
    await assert.rejects(d.run({ phone: true }));
    assert.equal(d.state.writes, 0);
    assert.equal(d.storage.has(SERVER_DEVELOPMENT_KEY), false);
  }
});

test('unreachable server, invalid credentials, or scan timeout leave existing configuration untouched', async () => {
  for (const options of [{ networkError: true }, { status: 401 }, { status: 500 }, { neverConnect: true }]) {
    const d = device(options);
    const before = [...d.storage];
    await assert.rejects(d.run({ phone: true, waitMilliseconds: 20 }));
    assert.equal(d.state.writes, 0); assert.deepEqual([...d.storage], before);
  }
});

test('failed resolution rolls configuration back and phone off removes only the server key', async () => {
  const failed = device({ brokenResolver: true });
  const before = [...failed.storage];
  await assert.rejects(failed.run({ phone: true }));
  assert.deepEqual([...failed.storage], before);
  const d = device(); d.storage.set(SERVER_DEVELOPMENT_KEY, value);
  await d.run({ phone: true, off: true, value: undefined });
  assert.equal(d.state.requests, 0); assert.equal(d.storage.has(SERVER_DEVELOPMENT_KEY), false);
  assert.equal(d.storage.get('felt-journal:v1'), 'keep-journal');
  assert.ok(d.storage.has(DEVELOPMENT_KEY));
});
