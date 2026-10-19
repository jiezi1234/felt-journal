const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { DEVELOPMENT_KEY, SERVER_DEVELOPMENT_KEY, validServerDevelopment, supportsLocalStickers } = require('../miniprogram/services/extraction-config');

(async () => {
  const off = process.argv.includes('--off');
  const file = path.resolve(__dirname, '../backend/.env.development');
  const env = fs.existsSync(file) ? Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter(line => /^[A-Z_]+=/.test(line)).map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1).trim()]; })) : {};
  const origin = process.env.FELT_DEV_ORIGIN || env.FELT_DEV_ORIGIN || '';
  const value = { endpoint: `${origin}/extract`, token: process.env.FELT_DEVELOPMENT_TOKEN || env.FELT_DEVELOPMENT_TOKEN || '' };
  if (!off) {
    if (!validServerDevelopment(value)) throw new Error('请在被 Git 忽略的 backend/.env.development 设置 FELT_DEV_ORIGIN 和 FELT_DEVELOPMENT_TOKEN');
    const health = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(10000) });
    const state = health.ok && await health.json();
    if (!supportsLocalStickers(state) || !state.developmentAccess) throw new Error('服务器尚未启动受保护的开发接口或模型版本不匹配');
    // No photo: a valid credential reaches the multipart validator (415).
    const auth = await fetch(value.endpoint, { method: 'POST', headers: { Authorization: `Bearer ${value.token}` }, signal: AbortSignal.timeout(10000) });
    if (auth.status !== 415) throw new Error('服务器开发凭证验证失败');
  }
  const mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
  try {
    const environment = await mini.evaluate(() => wx.getAccountInfoSync().miniProgram.envVersion);
    if (environment !== 'develop') throw new Error('只允许在开发版启用服务器调试');
    await mini.evaluate((serverKey, localKey, value) => {
      if (value) { wx.setStorageSync(serverKey, value); wx.removeStorageSync(localKey); }
      else wx.removeStorageSync(serverKey);
    }, SERVER_DEVELOPMENT_KEY, DEVELOPMENT_KEY, off ? null : value);
    console.log(off ? '服务器开发配置已关闭' : `已连接服务器 ${origin}；无需本机 Python 服务（仅开发调试）`);
  } finally { mini.disconnect(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
