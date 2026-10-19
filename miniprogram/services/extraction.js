const serviceConfig = require('./extraction-config');
// Backend contract: multipart photo -> { cutoutUrl, classification? }.
// Production provider credentials belong on the backend. Dev access is opt-in.
function network(task, invoke, local = false, developmentServer = false) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (fn, result) => { if (finished) return; finished = true; task.abort = null; fn(result); };
    const request = invoke(r => finish(resolve, r), error => {
      let failure = error;
      if (task.cancelled) failure = new Error('处理已取消');
      else if (local) failure = new Error(/timeout|timed out/i.test(error && (error.errMsg || error.message) || '')
        ? '本机抠图服务响应超时，请稍后重新提取'
        : '无法连接本机抠图服务，请启动服务后重新提取');
      else if (developmentServer) failure = new Error(/timeout|timed out/i.test(error && (error.errMsg || error.message) || '')
        ? '服务器处理超时，请稍后重试' : '无法连接抠图服务器，请检查网络和开发调试设置');
      finish(reject, failure);
    });
    task.abort = () => { request.abort(); finish(reject, new Error('处理已取消')); };
    if (task.cancelled) task.abort();
  });
}
async function extract(originalPath, task, onStage) {
  task.classification = null;
  const c = serviceConfig.resolve();
  if (c.mode !== 'remote' || !c.local && !c.developmentServer && !/^https:\/\//.test(c.endpoint)) throw new Error('主体提取服务尚未配置，可以选择保留原图记录');
  onStage('uploading');
  const uploaded = await network(task, (success, fail) => {
    const request = wx.uploadFile({ url: c.endpoint, header: c.header || {}, filePath: originalPath, name: 'photo', formData: { taskId: task.id }, timeout: c.timeout, success, fail });
    if (request.onProgressUpdate) request.onProgressUpdate(progress => { if (progress.progress >= 100 && !task.cancelled) onStage('extracting'); });
    return request;
  }, c.local, c.developmentServer);
  if (uploaded.statusCode !== 200) {
    if (uploaded.statusCode === 413) throw new Error('照片过大，请选择 15 MB 以内的照片');
    if (uploaded.statusCode === 415) throw new Error('这张照片暂不支持，请使用 JPEG、PNG 或 WEBP 照片');
    if (uploaded.statusCode === 401 && c.developmentServer) throw new Error('开发接口凭证已失效，请重新连接服务器');
    throw new Error('照片处理服务暂时不可用，请重试');
  }
  let payload;
  try { payload = JSON.parse(uploaded.data); } catch (_) { throw new Error('主体提取服务返回了无效结果'); }
  if (!serviceConfig.acceptsResult(payload.cutoutUrl, c)) throw new Error('没有获得有效主体图片，请重试或使用原图');
  if (task.cancelled) throw new Error('处理已取消');
  onStage('extracting');
  const downloaded = await network(task, (success, fail) => wx.downloadFile({ url: payload.cutoutUrl, header: c.header || {}, timeout: c.timeout, success, fail }), c.local, c.developmentServer);
  if (downloaded.statusCode === 401 && c.developmentServer) throw new Error('开发接口凭证已失效，请重新连接服务器');
  if (downloaded.statusCode !== 200) throw new Error('主体图片下载失败，请重新提取');
  task.classification = payload.classification || null;
  return downloaded.tempFilePath;
}
module.exports = { extract };
