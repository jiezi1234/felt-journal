const serviceConfig = require('./extraction-config');
// Backend contract: multipart photo -> { cutoutUrl, classification? }.
// Credentials belong on that backend. Cancelling aborts the live network request.
function network(task, invoke) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (fn, result) => { if (finished) return; finished = true; task.abort = null; fn(result); };
    const request = invoke(r => finish(resolve, r), e => finish(reject, e));
    task.abort = () => { request.abort(); finish(reject, new Error('处理已取消')); };
    if (task.cancelled) task.abort();
  });
}
async function extract(originalPath, task, onStage) {
  task.classification = null;
  const c = serviceConfig.resolve();
  if (c.mode !== 'remote' || !c.local && !/^https:\/\//.test(c.endpoint)) throw new Error('主体提取服务尚未配置，可以选择保留原图记录');
  onStage('uploading');
  const uploaded = await network(task, (success, fail) => {
    const request = wx.uploadFile({ url: c.endpoint, filePath: originalPath, name: 'photo', formData: { taskId: task.id }, timeout: c.timeout, success, fail });
    if (request.onProgressUpdate) request.onProgressUpdate(progress => { if (progress.progress >= 100 && !task.cancelled) onStage('extracting'); });
    return request;
  });
  if (uploaded.statusCode !== 200) {
    if (uploaded.statusCode === 413) throw new Error('照片过大，请选择 15 MB 以内的照片');
    if (uploaded.statusCode === 415) throw new Error('这张照片暂不支持，请使用 JPEG、PNG 或 WEBP 照片');
    throw new Error('照片处理服务暂时不可用，请重试');
  }
  let payload;
  try { payload = JSON.parse(uploaded.data); } catch (_) { throw new Error('主体提取服务返回了无效结果'); }
  if (!serviceConfig.acceptsResult(payload.cutoutUrl, c)) throw new Error('没有获得有效主体图片，请重试或使用原图');
  if (task.cancelled) throw new Error('处理已取消');
  onStage('extracting');
  const downloaded = await network(task, (success, fail) => wx.downloadFile({ url: payload.cutoutUrl, timeout: c.timeout, success, fail }));
  if (downloaded.statusCode !== 200) throw new Error('主体图片下载失败，请重新提取');
  task.classification = payload.classification || null;
  return downloaded.tempFilePath;
}
module.exports = { extract };
