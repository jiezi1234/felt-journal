// Short-lived service sessions stay in memory; AppSecret and session_key never enter the mini-program.
let cached = null;
let pending = null;

function invalidate(header) {
  if (cached && (!header || header.Authorization === 'Bearer ' + cached.token)) cached = null;
}

function exchange(origin) {
  return new Promise((resolve, reject) => {
    wx.login({ timeout: 10000,
      fail: () => reject(new Error('暂时无法登录，请检查网络后重试')),
      success: login => {
        if (!login.code) { reject(new Error('暂时无法登录，请重试')); return; }
        wx.request({ url: origin + '/auth/session', method: 'POST', timeout: 15000,
          data: { code: login.code }, header: { 'content-type': 'application/json' },
          fail: () => reject(new Error('无法连接照片服务，请检查网络后重试')),
          success: result => {
            if (result.statusCode === 429) { reject(new Error('操作太频繁，请稍后重试')); return; }
            if (result.statusCode !== 200) { reject(new Error('暂时无法登录照片服务，请稍后重试')); return; }
            const value = result.data;
            if (!value || !/^[A-Za-z0-9_-]{32,128}$/.test(value.token || '') || !Number.isFinite(value.expiresIn) || value.expiresIn < 60 || value.expiresIn > 86400) {
              reject(new Error('照片服务登录结果无效，请重试')); return;
            }
            resolve({ origin, token: value.token, expiresAt: Date.now() + (value.expiresIn - 30) * 1000 });
          }
        });
      }
    });
  });
}

async function headers(service) {
  const origin = service.origin;
  if (!origin || !/^https:\/\/[a-z0-9.-]+$/.test(origin)) throw new Error('照片服务地址无效');
  if (cached && cached.origin === origin && cached.expiresAt > Date.now()) return { Authorization: 'Bearer ' + cached.token };
  if (!pending || pending.origin !== origin) {
    const attempt = { origin };
    attempt.promise = exchange(origin).then(value => { if (pending === attempt) cached = value; return value; })
      .finally(() => { if (pending === attempt) pending = null; });
    pending = attempt;
  }
  const value = await pending.promise;
  return { Authorization: 'Bearer ' + value.token };
}

module.exports = { headers, invalidate };
