const { getStore, isThemeId, boardLabel } = require('../core/store');
const dates = require('../core/date');
const config = require('../core/config');
const renderer = require('../core/renderer');
const viewport = require('../core/board-viewport');
const platform = require('./platform');
function createShareExport() { return {
  data: { dateLabel: '', generating: true, error: '', imagePath: '', imageExpired: false, saving: false, albumDenied: false, albumSaved: false, count: 0,
    sharing: false, shareSupported: false, shareError: '', colors: config.colors, textures: config.textures, previewColor: '', previewTexture: '' },
  onLoad(query) { this.store = getStore(); this.date = query.board || query.date; this.refreshShareSupport(); },
  onReady() { this.generate(); },
  onUnload() { this.disposed = true; },
  refreshShareSupport() {
    let supported = false;
    try { supported = !this.shareMenuUnavailable && typeof wx.showShareImageMenu === 'function' && (typeof wx.canIUse !== 'function' || wx.canIUse('showShareImageMenu')); } catch (_) {}
    this.setData({ shareSupported: supported });
  },
  async generate() {
    if (this.busy || this.data.saving || this.data.sharing || this.disposed) return; this.busy = true;
    this.setData({ generating: true, error: '', imagePath: '', imageExpired: false, albumSaved: false, albumDenied: false, shareError: '' });
    try {
      if (!isThemeId(this.date) && (!dates.valid(this.date) || this.date > dates.key())) throw new Error('日期无效');
      if (this.store.getDraft(this.date)) throw new Error('当前板面存在未保存的布局，请返回板面先保存');
      const saved = this.store.view(this.date); if (!saved.items.length) throw new Error('空板暂时不能导出，先收藏一件生活记忆吧');
      // Share-only decoration: never write choices back to the journal board.
      const model = { ...saved, color: this.data.previewColor || saved.color, texture: this.data.previewTexture || saved.texture };
      this.setData({ previewColor: model.color, previewTexture: model.texture, dateLabel: boardLabel(model), count: model.items.length });
      const query = this.createSelectorQuery ? this.createSelectorQuery() : wx.createSelectorQuery();
      const canvas = await new Promise((resolve, reject) => query.select('#exportCanvas').fields({ node: true, size: true }).exec(r => r[0] && r[0].node ? resolve(r[0].node) : reject(new Error('画布暂时不可用，请重试'))));
      if (this.disposed) return;
      // Freeze the originating board's viewport for this share. Tall boards use
      // the same position mapping as the on-screen canvas, without rewriting data.
      const frame = this.exportViewport || config.board;
      if (!Number.isFinite(frame.width) || !Number.isFinite(frame.height) || frame.width <= 0 || frame.height <= 0) throw new Error('板面尺寸无效，请关闭分享后重试');
      const display = viewport.present(model, frame.width, frame.height), dimensions = display.dimensions;
      const bounds = renderer.frame(dimensions), scale = config.exportWidth / Math.max(bounds.width, bounds.height);
      canvas.width = Math.round(bounds.width * scale); canvas.height = Math.round(bounds.height * scale);
      const images = await renderer.loadImages(canvas, display.model.items, {}, true); if (this.disposed) return;
      const ctx = canvas.getContext('2d'), sy = canvas.height / bounds.height;
      ctx.setTransform(canvas.width / dimensions.width, 0, 0, sy, 0, bounds.top * sy);
      renderer.paint(ctx, display.model, images, '', dimensions, null, canvas.width / dimensions.width);
      const result = await platform.call('canvasToTempFilePath', { canvas, x: 0, y: 0, width: canvas.width, height: canvas.height, destWidth: canvas.width, destHeight: canvas.height, fileType: 'png' });
      if (!this.disposed) this.setData({ generating: false, imagePath: result.tempFilePath, dateLabel: boardLabel(model), isTheme: model.type === 'theme', count: model.items.length });
    } catch (e) { if (!this.disposed) this.setData({ generating: false, error: platform.message(e, '作品生成失败，请重试') }); }
    finally { this.busy = false; }
  },
  chooseColor(e) { return this.chooseAppearance('previewColor', config.colors, e.currentTarget.dataset.value); },
  chooseTexture(e) { return this.chooseAppearance('previewTexture', config.textures, e.currentTarget.dataset.value); },
  chooseAppearance(key, choices, value) {
    if (this.busy || this.data.generating || this.data.saving || this.data.sharing || this.disposed || !choices.some(option => option.value === value) || this.data[key] === value) return;
    this.setData({ [key]: value }); return this.generate();
  },
  hasImage() {
    if (this.disposed || !this.data.imagePath || this.data.imageExpired || this.data.generating) return false;
    try { wx.getFileSystemManager().accessSync(this.data.imagePath); return true; }
    catch (_) { this.setData({ imageExpired: true, shareError: '', error: '作品图片已失效，请重新生成后再保存或分享' }); return false; }
  },
  async shareImage() {
    if (this.disposed || this.data.saving || this.data.sharing || !this.hasImage()) return;
    this.refreshShareSupport(); if (!this.data.shareSupported) return this.preview();
    this.setData({ sharing: true, shareError: '' });
    try {
      // Pass the exact preview, with no local record link or implicit app entry.
      // Invoke directly from the tap, without awaiting another API first.
      await platform.call('showShareImageMenu', { path: this.data.imagePath, needShowEntrance: false });
      // The API callback is not a receipt: never mark a message sent or album saved.
    } catch (e) {
      if (this.disposed) return;
      const reason = String(e && (e.errMsg || e.message) || '');
      if (/cancel/i.test(reason)) return;
      if (/not support|unsupported|not implement|is not a function|暂不支持/i.test(reason)) {
        // Some clients expose the API but cannot open it. Keep the fallback for
        // this card's lifetime; require a fresh tap for the next native action.
        this.shareMenuUnavailable = true;
        this.setData({ shareSupported: false, shareError: '' });
      }
      else if (this.hasImage()) this.setData({ shareError: '分享面板暂时无法打开，请重试，或保存到相册后发送' });
    } finally { if (!this.disposed) this.setData({ sharing: false }); }
  },
  async saveAlbum() {
    if (this.disposed || this.data.saving || this.data.sharing || !this.hasImage()) return;
    this.setData({ saving: true, error: '', albumDenied: false, albumSaved: false });
    try {
      await platform.call('saveImageToPhotosAlbum', { filePath: this.data.imagePath });
      if (!this.disposed) { this.setData({ albumSaved: true }); platform.toast('已保存到相册'); }
    } catch (e) {
      if (this.disposed || !this.hasImage()) return;
      if (/cancel/i.test(String(e && (e.errMsg || e.message) || ''))) return;
      const denied = /auth|denied|permission|authorize/i.test(e.errMsg || '');
      this.setData({ albumDenied: denied, error: denied ? '尚未获得相册权限，请在设置中允许保存到相册后重试' : '作品已生成，但尚未保存到相册，请重试' });
    } finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  async settings() { try { await platform.call('openSetting', {}); if (!this.disposed) this.setData({ albumDenied: false }); } catch (_) { if (!this.disposed) platform.toast('设置未打开，请在小程序设置中允许相册权限'); } },
  async preview() {
    if (this.disposed || this.data.saving || this.data.sharing || !this.hasImage()) return;
    this.setData({ sharing: true, shareError: '' });
    try {
      // Native preview provides a second user-initiated sharing path, without
      // album permission. Explicitly retain its long-press menu on all clients.
      await platform.call('previewImage', { current: this.data.imagePath, urls: [this.data.imagePath], showmenu: true });
    } catch (e) {
      if (this.disposed || /cancel/i.test(String(e && (e.errMsg || e.message) || ''))) return;
      if (this.hasImage()) this.setData({ shareError: '图片暂时无法打开，请重试，或保存到相册后在微信中发送' });
    } finally { if (!this.disposed) this.setData({ sharing: false }); }
  },
  back() { if (!this.disposed && !this.data.saving && !this.data.sharing) platform.back(); }
}; }
module.exports = { createShareExport };
