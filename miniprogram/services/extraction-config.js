const config = require('../core/config');
const DEVELOPMENT_KEY = 'felt-journal:dev-extraction:v1';
const SERVER_DEVELOPMENT_KEY = 'felt-journal:server-extraction:v1';
function validServerDevelopment(value) {
  if (!value || typeof value !== 'object' || !/^[A-Za-z0-9_-]{32,128}$/.test(value.token || '')) return false;
  const match = /^http:\/\/((?:\d{1,3}\.){3}\d{1,3})(?::([1-9]\d{0,4}))?\/extract$/.exec(value.endpoint || '');
  return !!match && match[1].split('.').every(part => Number(part) <= 255 && String(Number(part)) === part)
    && !match[1].startsWith('127.') && match[1] !== '0.0.0.0' && (!match[2] || Number(match[2]) <= 65535);
}
function resolve() {
  const base = Object.assign({}, config.extraction, { local: false });
  // Explicit development overrides never apply to trial/release builds.
  try {
    const info = wx.getSystemInfoSync();
    const account = wx.getAccountInfoSync();
    if (account.miniProgram.envVersion !== 'develop') return base;
    const server = wx.getStorageSync(SERVER_DEVELOPMENT_KEY);
    if (validServerDevelopment(server)) return { mode: 'remote', endpoint: server.endpoint, timeout: base.timeout, local: false,
      developmentServer: true, origin: server.endpoint.slice(0, -8), header: { Authorization: `Bearer ${server.token}` } };
    if (info.platform !== 'devtools') return base;
    const endpoint = wx.getStorageSync(DEVELOPMENT_KEY);
    const match = /^http:\/\/127\.0\.0\.1:(\d{1,5})\/extract$/.exec(endpoint || '');
    if (match && Number(match[1]) > 0 && Number(match[1]) <= 65535) return { mode: 'remote', endpoint, timeout: base.timeout, local: true, origin: endpoint.slice(0, -8) };
  } catch (_) { /* Older runtimes or no explicit development configuration. */ }
  return base;
}
function acceptsResult(url, service) {
  if (typeof url !== 'string') return false;
  if (!service.local && !service.developmentServer) return /^https:\/\//.test(url);
  return url.startsWith(`${service.origin}/cutouts/`) && /^[a-f0-9]{32}\.png$/.test(url.slice(`${service.origin}/cutouts/`.length));
}
function supportsLocalStickers(health) {
  return !!health && health.status === 'ok' && health.model === 'nosh-mnn' && health.stickerStyle === 'nosh-white-v1';
}
module.exports = { DEVELOPMENT_KEY, SERVER_DEVELOPMENT_KEY, validServerDevelopment, resolve, acceptsResult, supportsLocalStickers };
