// A real network check using the compiled mini-program adapter; no journal edits.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

(async () => {
  if (!process.argv[2]) throw new Error('请传入允许上传到开发服务器的测试照片路径');
  const bytes = fs.readFileSync(path.resolve(process.argv[2]));
  let mini, source, downloaded;
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    const connection = await mini.evaluate(() => {
      const config = require('services/extraction-config.js').resolve();
      return { server: config.developmentServer, endpoint: config.endpoint, local: config.local };
    });
    assert.equal(connection.server, true); assert.equal(connection.local, false);
    source = await mini.evaluate((data, name) => {
      const file = wx.env.USER_DATA_PATH + '/' + name;
      wx.getFileSystemManager().writeFileSync(file, data, 'base64'); return file;
    }, bytes.toString('base64'), `felt-server-probe-${Date.now()}.jpg`);
    const started = Date.now();
    const result = await mini.evaluate(file => {
      const stages = [], task = { id: 'server-network-probe' };
      return require('services/extraction.js').extract(file, task, stage => stages.push(stage))
        .then(filePath => ({ filePath, classification: task.classification, stages }));
    }, source);
    downloaded = result.filePath;
    const png = Buffer.from(await mini.evaluate(file => wx.getFileSystemManager().readFileSync(file, 'base64'), downloaded), 'base64');
    const image = await loadImage(png), canvas = createCanvas(image.width, image.height), ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    let low = 255, high = 0;
    for (let i = 3; i < pixels.length; i += 4) { low = Math.min(low, pixels[i]); high = Math.max(high, pixels[i]); }
    assert.equal(low, 0); assert.equal(high, 255);
    const denied = await fetch(connection.endpoint, { method: 'POST', signal: AbortSignal.timeout(10000) });
    assert.equal(denied.status, 401);
    const health = await (await fetch(connection.endpoint.replace(/\/extract$/, '/health'), { signal: AbortSignal.timeout(10000) })).json();
    assert.equal(health.modelLoaded, true); assert.equal(health.classificationLoaded, true);
    const report = { passed: true, endpoint: connection.endpoint, width: image.width, height: image.height, alpha: [low, high],
      milliseconds: Date.now() - started, classification: result.classification, stages: result.stages, unauthorizedUpload: denied.status,
      health, scope: 'Compiled mini-program adapter -> real wx.uploadFile -> server inference -> authenticated wx.downloadFile; no journal edits' };
    const reportPath = path.resolve(__dirname, '../artifacts/server-extraction-verification.json');
    fs.mkdirSync(path.dirname(reportPath), { recursive: true }); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    if (mini) {
      try { await mini.evaluate(files => files.forEach(file => { try { wx.getFileSystemManager().unlinkSync(file); } catch (_) {} }), [source, downloaded].filter(Boolean)); }
      finally { mini.disconnect(); }
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
