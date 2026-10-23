const fs = require('node:fs');
const path = require('node:path');
const automator = require('miniprogram-automator');
const { DEVELOPMENT_KEY, SERVER_DEVELOPMENT_KEY, validServerDevelopment, supportsLocalStickers } = require('../miniprogram/services/extraction-config');

async function withTimeout(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function configure(mini, { value, off = false, phone = false, waitMilliseconds = 180000, log = console.log }) {
  if (!off && !validServerDevelopment(value)) throw new Error('开发接口地址或凭证无效');
  if (phone) {
    log('请用手机微信扫描真机调试二维码，保持手机小程序打开；连接后将自动配置服务（最多等待 3 分钟）。');
    await withTimeout(mini.remote(), waitMilliseconds, '等待手机连接超时，配置尚未写入；请重新运行 npm run dev:phone 并扫码');
  }
  // Check in the target runtime, not the simulator that existed before remote().
  const target = await mini.evaluate(() => ({
    platform: wx.getSystemInfoSync().platform,
    environment: wx.getAccountInfoSync().miniProgram.envVersion
  }));
  if (target.environment !== 'develop') throw new Error('只允许在开发版启用服务器调试');
  if (phone && !['ios', 'android'].includes(target.platform)) throw new Error('当前仍未连接到手机，请重新运行 npm run dev:phone 并扫描真机调试二维码');

  if (!off) {
    // Probe from the target device before saving anything. No photo or journal data is sent.
    const probe = await mini.evaluate(server => new Promise(resolve => {
      wx.request({ url: server.endpoint, method: 'POST', data: '', timeout: 10000,
        header: { Authorization: `Bearer ${server.token}`, 'content-type': 'application/octet-stream' },
        success: result => resolve({ status: result.statusCode }),
        fail: () => resolve({ networkError: true }) });
    }), value);
    if (probe.networkError) throw new Error('当前设备无法连接开发服务；请检查网络，并确认正在使用真机调试且已关闭开发环境的域名校验。配置尚未写入');
    if (probe.status !== 415) throw new Error('当前设备的开发接口鉴权未通过，配置尚未写入');
  }
  const result = await mini.evaluate((serverKey, localKey, value, phone) => {
    // Recheck immediately before writing; don't configure a different runtime after a disconnect.
    const platform = wx.getSystemInfoSync().platform;
    if (wx.getAccountInfoSync().miniProgram.envVersion !== 'develop' || phone && !['ios', 'android'].includes(platform)) {
      throw new Error('调试目标已改变，未写入服务配置');
    }
    const previousServer = wx.getStorageSync(serverKey), previousLocal = wx.getStorageSync(localKey);
    try {
      if (value) {
        wx.setStorageSync(serverKey, value);
        wx.removeStorageSync(localKey);
        const active = require('services/extraction-config').resolve();
        if (!active.developmentServer || active.endpoint !== value.endpoint || active.header.Authorization !== `Bearer ${value.token}`) {
          throw new Error('服务配置未生效，已恢复之前的配置');
        }
      } else wx.removeStorageSync(serverKey);
    } catch (error) {
      if (previousServer) wx.setStorageSync(serverKey, previousServer); else wx.removeStorageSync(serverKey);
      if (previousLocal) wx.setStorageSync(localKey, previousLocal); else wx.removeStorageSync(localKey);
      throw error;
    }
    return { platform, configured: !!value };
  }, SERVER_DEVELOPMENT_KEY, DEVELOPMENT_KEY, off ? null : value, phone);
  const label = result.platform === 'devtools' ? '电脑模拟器' : `手机（${result.platform}）`;
  log(off ? `${label}的服务器开发配置已关闭` : `${label}已连接服务器 ${value.endpoint.slice(0, -8)}，鉴权与配置读取通过；可以点击“重新提取”或重新选图。`);
  if (!phone && result.platform === 'devtools') log('这份配置仅保存在模拟器；手机调试请运行 npm run dev:phone 并扫码连接。');
  return result;
}

async function main() {
  const off = process.argv.includes('--off'), phone = process.argv.includes('--phone');
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
    await configure(mini, { value, off, phone });
  } finally { mini.disconnect(); }
}

module.exports = { configure };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
