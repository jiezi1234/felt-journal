const automator = require('miniprogram-automator');
const key = require('../miniprogram/services/extraction-config').DEVELOPMENT_KEY;
(async () => {
  const off = process.argv.includes('--off'), endpoint = process.env.WECHAT_EXTRACTION_ENDPOINT || 'http://127.0.0.1:8787/extract';
  if (!off) {
    const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/extract$/.exec(endpoint);
    if (!match || Number(match[1]) > 65535) throw new Error('本机调试地址必须是有效的 127.0.0.1 端口与 /extract 路径');
    const response = await fetch(endpoint.replace(/\/extract$/, '/health'));
    if (!response.ok) throw new Error('本地主体提取服务尚未启动');
  }
  const mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
  try {
    const info = await mini.systemInfo(); if (info.platform !== 'devtools') throw new Error('此开关仅用于开发者工具');
    await mini.evaluate((key, value) => value ? wx.setStorageSync(key, value) : wx.removeStorageSync(key), key, off ? '' : endpoint);
    await mini.reLaunch('/pages/index/index');
    console.log(off ? '本机提取已关闭' : '开发者工具已连接本机真实提取服务；手机预览不使用此开关');
  } finally { mini.disconnect(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
