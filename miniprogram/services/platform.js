const config = require('../core/config');
const activeFiles = new Set();
function call(name, options) { return new Promise((resolve, reject) => wx[name](Object.assign({}, options, { success: resolve, fail: reject }))); }
function message(error, fallback) {
  const text = String(error && (error.message || error.errMsg) || '');
  if (/space|quota|limit|exceed|disk|storage.*full/i.test(text)) return '本地空间不足，请释放手机空间后重试，已保存的记录会保留';
  if (/auth|denied|permission|authorize|privacy/i.test(text)) return '未获得相机或相册权限，请在设置中允许后重试';
  return error && error.message || fallback || '操作未完成，请重试';
}
function toast(text) { wx.showToast({ title: text, icon: 'none', duration: 2500 }); }
async function choose(source) {
  const modern = typeof wx.chooseMedia === 'function';
  const r = await call(modern ? 'chooseMedia' : 'chooseImage', { count: 1, mediaType: ['image'], sizeType: ['original'], sourceType: [source] });
  const file = r.tempFiles[0];
  if (file.size > config.maxImageBytes) throw new Error('请选择 15 MB 以内的照片');
  const info = await call('getImageInfo', { src: file.tempFilePath || file.path });
  return { path: info.path, width: info.width, height: info.height };
}
function root() { return `${wx.env.USER_DATA_PATH}/felt-journal`; }
function fsCall(method, args) { return new Promise((resolve, reject) => wx.getFileSystemManager()[method](Object.assign({}, args, { success: resolve, fail: reject }))); }
async function persist(path, name) {
  const fs = wx.getFileSystemManager();
  try { fs.accessSync(root()); } catch (_) { fs.mkdirSync(root(), true); }
  const ext = /\.(png|jpg|jpeg|webp)$/i.exec(path.split('?')[0]);
  const target = `${root()}/${name}.${ext ? ext[1].toLowerCase() : 'png'}`;
  activeFiles.add(target);
  try { await fsCall('copyFile', { srcPath: path, destPath: target }); }
  catch (error) { activeFiles.delete(target); throw error; }
  return target;
}
async function unlink(path) {
  if (!path || !path.startsWith(`${root()}/`)) return;
  if (!/^[a-z0-9]+_[a-z0-9]+_[a-z0-9]+_(original|subject)\.(png|jpg|jpeg|webp)$/.test(path.slice(root().length + 1))) return;
  try { await fsCall('unlink', { filePath: path }); } catch (_) { /* Retry garbage collection later. */ }
}
async function collect(store) {
  const garbage = [...new Set(store.get().garbage)];
  for (const path of garbage) {
    if (store.referenced(path)) continue;
    await unlink(path);
    // If unlink failed keep its queue entry for the next attempt.
    try { wx.getFileSystemManager().accessSync(path); } catch (_) {
      try { store.commit(s => { s.garbage = s.garbage.filter(p => p !== path); }); } catch (_) { return; }
    }
  }
}
async function sweepUnused(store) {
  // Only run at app launch, before any photo task exists. Never traverse other
  // user directories or remove a file referenced by a committed memory.
  let names;
  try { names = (await fsCall('readdir', { dirPath: root() })).files; } catch (_) { return; }
  for (const name of names) {
    if (!/^[a-z0-9]+_[a-z0-9]+_[a-z0-9]+_(original|subject)\.(png|jpg|jpeg|webp)$/.test(name)) continue;
    const path = `${root()}/${name}`;
    if (!activeFiles.has(path) && !store.referenced(path)) await unlink(path);
  }
  await collect(store);
}
function releaseFiles(paths) { paths.forEach(path => activeFiles.delete(path)); }
async function localNotice(store) {
  if (store.get().localNoticeSeen) return;
  await call('showModal', { title: '记忆已保存在本机', content: '记录保存在当前设备。卸载小程序或清理相关数据可能导致记录丢失，重要作品建议导出保存。', showCancel: false, confirmColor: '#4D7D5B' });
  try { store.commit(s => { s.localNoticeSeen = true; }); } catch (_) { /* Show again next time. */ }
}
async function confirmDelete(count = 0) {
  const r = await call('showModal', { title: '彻底删除这条记忆？', content: `照片、文字和所有板面中的摆放会一起删除，无法恢复。${count ? `当前用于 ${count} 块板。` : ''}不会删除手机相册中的原照片。`, confirmText: '彻底删除', confirmColor: '#A44737' });
  return r.confirm;
}
async function confirmRemovePlacement() {
  const r = await call('showModal', { title: '是否删除该部件？', content: '将从当前毛毡板移除，照片、文字和其他板面的物件会保留。', confirmText: '确定', cancelText: '取消', confirmColor: '#A44737' }); return r.confirm;
}
function back() { if (getCurrentPages().length > 1) wx.navigateBack(); else wx.switchTab({ url: '/pages/index/index' }); }
function syncTab(page, active, hidden = false) {
  const tab = page.getTabBar && page.getTabBar();
  if (tab) tab.setData({ active, hidden });
}
function unloadGuard(enabled, text) {
  if (enabled && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: text || '尚有未保存的修改，离开可能丢失。', fail() {} });
  else if (wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload({ fail() {} });
}
module.exports = { call, message, toast, choose, persist, unlink, collect, sweepUnused, releaseFiles, localNotice, confirmDelete, confirmRemovePlacement, back, syncTab, unloadGuard, fsCall, root };
