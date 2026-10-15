const config = require('../core/config');
const DEVELOPMENT_KEY = 'felt-journal:dev-extraction:v1';
function resolve() {
  const base = Object.assign({}, config.extraction, { local: false });
  // Opt-in loopback testing is confined to DevTools' development runtime.
  // Device/preview/release builds always use the configured HTTPS service.
  try {
    const info = wx.getSystemInfoSync();
    const account = wx.getAccountInfoSync();
    if (info.platform !== 'devtools' || account.miniProgram.envVersion !== 'develop') return base;
    const endpoint = wx.getStorageSync(DEVELOPMENT_KEY);
    const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/extract$/.exec(endpoint || '');
    if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) return { mode: 'remote', endpoint, timeout: base.timeout, local: true, origin: endpoint.slice(0, -8) };
  } catch (_) { /* Older runtimes or no explicit development configuration. */ }
  return base;
}
function acceptsResult(url, service) {
  if (typeof url !== 'string') return false;
  if (!service.local) return /^https:\/\//.test(url);
  return url.startsWith(`${service.origin}/cutouts/`) && /^[a-f0-9]{32}\.png$/.test(url.slice(`${service.origin}/cutouts/`.length));
}
module.exports = { DEVELOPMENT_KEY, resolve, acceptsResult };
