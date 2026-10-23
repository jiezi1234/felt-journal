const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../miniprogram/services/session'), 'utf8');

function runtime(options = {}) {
  const state = { now: 100000, logins: 0, requests: 0 };
  const module = { exports: {} };
  const wx = {
    login: args => { state.logins++; queueMicrotask(() => options.loginFail ? args.fail({}) : args.success({ code: 'code-' + state.logins })); },
    request: args => {
      state.requests++;
      assert.equal(args.url, 'https://api.felt.example/auth/session');
      assert.deepEqual(Object.keys(args.data), ['code']);
      assert.equal(args.header.Authorization, undefined);
      queueMicrotask(() => options.networkFail ? args.fail({}) : args.success({ statusCode: options.status || 200,
        data: options.body || { token: String(state.logins).repeat(43), expiresIn: 7200 } }));
    }
  };
  vm.runInNewContext(source, { module, wx, Date: { now: () => state.now } });
  return { api: module.exports, state, service: { origin: 'https://api.felt.example' } };
}

test('concurrent photo work shares one silent login; expiry triggers fresh login', async () => {
  const r = runtime();
  const [a, b] = await Promise.all([r.api.headers(r.service), r.api.headers(r.service)]);
  assert.equal(a.Authorization, b.Authorization);
  assert.equal(r.state.logins, 1); assert.equal(r.state.requests, 1);
  await r.api.headers(r.service); assert.equal(r.state.logins, 1);
  r.state.now += 7200000;
  const next = await r.api.headers(r.service);
  assert.notEqual(a.Authorization, next.Authorization); assert.equal(r.state.logins, 2);
  r.api.invalidate(a); await r.api.headers(r.service);
  assert.equal(r.state.logins, 2, 'late failure from an older token must not discard the refreshed session');
  r.api.invalidate(next); await r.api.headers(r.service); assert.equal(r.state.logins, 3);
});

test('login and malformed sessions fail closed and may be retried', async () => {
  for (const options of [{ loginFail: true }, { networkFail: true }, { status: 401 }, { status: 503 },
    { body: { token: 'bad', expiresIn: 7200 } }, { body: { token: 'a'.repeat(43), expiresIn: -1 } }]) {
    const r = runtime(options);
    await assert.rejects(r.api.headers(r.service));
    await assert.rejects(r.api.headers(r.service));
    assert.equal(r.state.logins, 2);
  }
  const r = runtime({ status: 429 }); await assert.rejects(r.api.headers(r.service), /太频繁/);
  const invalid = runtime(); await assert.rejects(invalid.api.headers({ origin: 'http://api.felt.example' }));
  assert.equal(invalid.state.logins, 0);
});
