// Real WeChat login + HTTPS extraction using an explicitly supplied public test photo.
// Only the two development connection settings are temporarily removed, then restored.
// Journal records, layouts, drafts and stored photos are never replaced.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

(async () => {
  if (!process.argv[2]) throw Error('请传入允许上传到服务器的公开测试照片路径');
  const bytes = fs.readFileSync(path.resolve(process.argv[2]));
  const mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
  let source, downloaded;
  try {
    const runtime = await mini.evaluate(() => {
      const page = getCurrentPages().slice(-1)[0];
      return { platform: wx.getSystemInfoSync().platform, envVersion: wx.getAccountInfoSync().miniProgram.envVersion,
        busy: !!(page && (page.busy && page.busy() || page.dirty || page.noteDirty)) };
    });
    assert.equal(runtime.busy, false, 'Finish editing before this network verification');
    source = await mini.evaluate((data, name) => {
      const file = wx.env.USER_DATA_PATH + '/' + name;
      wx.getFileSystemManager().writeFileSync(file, data, 'base64'); return file;
    }, bytes.toString('base64'), `felt-auth-probe-${Date.now()}.jpg`);
    const started = Date.now();
    const result = await mini.evaluate(async file => {
      const configuration = require('services/extraction-config');
      const keys = [configuration.DEVELOPMENT_KEY, configuration.SERVER_DEVELOPMENT_KEY];
      const storedKeys = wx.getStorageInfoSync().keys;
      const old = keys.map(key => ({ key, present: storedKeys.includes(key), value: wx.getStorageSync(key) }));
      try {
        keys.forEach(key => wx.removeStorageSync(key));
        const service = configuration.resolve();
        if (service.auth !== 'wechat' || service.local || service.developmentServer) throw Error('Compiled WeChat session adapter is not active');
        const task = { id: 'production-auth-probe' }, stages = [];
        const filePath = await require('services/extraction').extract(file, task, stage => stages.push(stage));
        return { filePath, endpoint: service.endpoint, classification: task.classification, alignment: task.alignment, stages };
      } catch (error) { return { failed: error.message }; }
      finally { old.forEach(item => item.present ? wx.setStorageSync(item.key, item.value) : wx.removeStorageSync(item.key)); }
    }, source);
    if (result.failed) throw Error(result.failed);
    downloaded = result.filePath;
    const png = Buffer.from(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), downloaded), 'base64');
    const image = await loadImage(png), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let low = 255, high = 0;
    for (let i = 3; i < pixels.length; i += 4) { low = Math.min(low, pixels[i]); high = Math.max(high, pixels[i]); }
    assert.equal(low, 0); assert.equal(high, 255);
    const checks = await mini.evaluate(endpoint => {
      const request = options => new Promise(resolve => wx.request(Object.assign({ timeout: 10000,
        success: r => resolve({ status: r.statusCode, data: r.data }), fail: r => resolve({ error: r.errMsg }) }, options)));
      return Promise.all([request({ url: endpoint, method: 'POST', data: {} }),
        request({ url: endpoint.replace(/\/extract$/, '/health') }), request({ url: 'https://example.com/' })]);
    }, result.endpoint);
    assert.equal(checks[0].status, 401);
    assert.equal(checks[1].status, 200);
    assert.match(checks[2].error || '', /url not in domain list/, 'Domain validation must remain enabled');
    const health = checks[1].data;
    assert.equal(health.loginEnabled, true); assert.equal(health.modelLoaded, true); assert.equal(health.classificationLoaded, true);
    assert.equal(result.alignment.width, image.width); assert.equal(result.alignment.height, image.height);
    const report = { passed: true, ...runtime, endpoint: result.endpoint, width: image.width, height: image.height, alpha: [low, high],
      milliseconds: Date.now() - started, classification: result.classification, stages: result.stages, unauthorizedUpload: checks[0].status,
      domainValidation: 'unconfigured domain rejected',
      scope: 'Compiled production adapter; real wx.login, HTTPS session exchange, upload, inference and authenticated download. Not an uploaded trial build.' };
    fs.mkdirSync(path.resolve(__dirname, '../artifacts'), { recursive: true });
    fs.writeFileSync(path.resolve(__dirname, '../artifacts/production-extraction-verification.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    try { await mini.evaluate(files => files.forEach(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }), [source, downloaded].filter(Boolean)); }
    finally { mini.disconnect(); }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
