const { getStore } = require('../../core/store');
const edit = require('../../core/photo-edit');
const platform = require('../../services/platform');
const { SubjectEditTask } = require('../../services/subject-edit');
Page({
  data: { loading: true, saving: false, ready: false, error: '', saveError: '', source: 'subject', ratio: 0, dirty: false, handles: [], dimensions: '',
    ratios: [{ name: '自由', value: 0 }, { name: '1:1', value: 1 }, { name: '4:3', value: 4 / 3 }, { name: '3:4', value: 3 / 4 }] },
  onLoad(query) {
    this.store = getStore(); this.id = query.id; this.setData({ fromResult: query.from === 'result' });
    try { this.memory = this.store.get().memories[this.id]; if (!this.memory) throw new Error('这条记忆已被删除或无法读取'); }
    catch (error) { this.setData({ loading: false, error: platform.message(error) }); }
  },
  onReady() { if (this.memory) this.prepare(); },
  onHide() { this.touchCancel(); },
  onUnload() { this.disposed = true; this.token = (this.token || 0) + 1; if (this.task) this.task.cancel(); platform.unloadGuard(false); },
  onResize() { if (this.canvas) this.measure(); },
  async prepare() {
    this.setData({ loading: true, error: '' });
    try {
      const result = await new Promise(resolve => wx.createSelectorQuery().select('#cropCanvas').fields({ node: true, size: true }).select('#outputCanvas').fields({ node: true }).exec(resolve));
      if (this.disposed) return;
      if (!result[0] || !result[0].node || !result[0].width || !result[1] || !result[1].node) throw new Error('图片画布暂时不可用，请重试');
      this.canvas = result[0].node; this.output = result[1].node; this.resizeCanvas(result[0]);
      await this.loadSource(this.data.source);
    } catch (error) { if (!this.disposed) this.setData({ loading: false, ready: false, error: platform.message(error, '图片读取失败，请重试') }); }
  },
  resizeCanvas(rect) {
    this.screen = { width: rect.width, height: rect.height };
    this.dpr = Math.min(wx.getSystemInfoSync().pixelRatio || 2, 2);
    this.canvas.width = Math.round(rect.width * this.dpr); this.canvas.height = Math.round(rect.height * this.dpr);
  },
  measure() {
    this.touchCancel(); wx.createSelectorQuery().select('#cropCanvas').boundingClientRect(rect => {
      if (this.disposed || !rect || !rect.width) return;
      this.resizeCanvas(rect); this.draw();
    }).exec();
  },
  async loadSource(source) {
    if (!this.canvas || !this.memory || this.data.saving || this.disposed) return;
    this.touchCancel(); const token = this.token = (this.token || 0) + 1;
    this.setData({ source, ready: false, loading: true, error: '', saveError: '', handles: [] });
    const ctx = this.canvas.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const path = source === 'original' ? this.memory.originalPath : this.memory.subjectPath;
    try {
      const image = await new Promise((resolve, reject) => {
        const img = this.canvas.createImage(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('这张图片无法读取，可切换另一张图片或返回详情替换照片')); img.src = path;
      });
      if (this.disposed || token !== this.token) return;
      if (!image.width || !image.height) throw new Error('图片尺寸无效，请返回详情替换照片');
      this.image = image; this.state = edit.initial(image.width, image.height); this.sourcePath = path;
      this.setData({ loading: false, ready: true }); this.update();
    } catch (error) { if (!this.disposed && token === this.token) this.setData({ loading: false, error: platform.message(error) }); }
  },
  async source(e) {
    const source = e.currentTarget.dataset.source;
    if (this.data.saving || this.data.loading || !this.memory || !['subject', 'original'].includes(source) || this.data.source === source) return;
    if (this.state && this.image && edit.changed(this.state, this.image.width, this.image.height)) {
      const result = await platform.call('showModal', { title: '切换编辑图片？', content: '当前未保存的裁剪、旋转和镜像会重置。', confirmText: '切换' });
      if (!result.confirm || this.disposed) return;
    }
    await this.loadSource(source);
  },
  retry() { if (!this.data.saving && !this.data.loading && this.memory) this.prepare(); },
  bounds() { return edit.size(this.image.width, this.image.height, this.state.turn); },
  available() { return this.data.ready && !this.data.loading && !this.data.saving && !this.disposed; },
  update() {
    const dirty = this.data.source === 'original' || edit.changed(this.state, this.image.width, this.image.height), size = edit.outputSize(this.state.crop);
    this.setData({ dirty, ratio: this.state.ratio, dimensions: `${size.width} × ${size.height}`, saveError: '' });
    platform.unloadGuard(dirty, '图片调整尚未保存，离开会丢失本次调整。'); this.draw();
  },
  ratio(e) {
    if (!this.available()) return; this.touchCancel();
    const ratio = Number(e.currentTarget.dataset.ratio); if (!this.data.ratios.some(r => r.value === ratio)) return;
    this.state.ratio = ratio; this.state.crop = edit.preset(this.bounds(), ratio); this.update();
  },
  rotate() { if (this.available()) { this.touchCancel(); this.state = edit.rotate(this.state, this.bounds()); this.update(); } },
  mirror() { if (this.available()) { this.touchCancel(); this.state = edit.mirror(this.state, this.bounds()); this.update(); } },
  reset() { if (this.available()) { this.touchCancel(); this.state = edit.initial(this.image.width, this.image.height); this.update(); } },
  draw() {
    if (!this.image || !this.state || !this.canvas || this.disposed || !this.data.ready) return;
    const { width, height } = this.screen, bounds = this.bounds();
    const scale = Math.min((width - 48) / bounds.width, (height - 48) / bounds.height);
    const left = (width - bounds.width * scale) / 2, top = (height - bounds.height * scale) / 2;
    this.viewport = { scale, left, top };
    const ctx = this.canvas.getContext('2d'); ctx.setTransform(this.canvas.width / width, 0, 0, this.canvas.height / height, 0, 0); ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#FAF9F6'; ctx.fillRect(0, 0, width, height);
    for (let y = 0; y < height; y += 12) for (let x = 0; x < width; x += 12) if ((x / 12 + y / 12) % 2 === 0) { ctx.fillStyle = '#EEEAE3'; ctx.fillRect(x, y, 12, 12); }
    ctx.save(); ctx.translate(left, top); ctx.scale(scale, scale); edit.drawImage(ctx, this.image, this.state); ctx.restore();
    const c = this.state.crop, x = left + c.x * scale, y = top + c.y * scale, w = c.width * scale, h = c.height * scale;
    ctx.fillStyle = 'rgba(48, 40, 31, .48)'; ctx.fillRect(0, 0, width, y); ctx.fillRect(0, y + h, width, height - y - h); ctx.fillRect(0, y, x, h); ctx.fillRect(x + w, y, width - x - w, h);
    ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
    ctx.lineWidth = 0.6; ctx.beginPath();
    for (const fraction of [1 / 3, 2 / 3]) { ctx.moveTo(x + w * fraction, y); ctx.lineTo(x + w * fraction, y + h); ctx.moveTo(x, y + h * fraction); ctx.lineTo(x + w, y + h * fraction); }
    ctx.stroke();
    // Native Canvas captures may omit overlaid views. Draw visible grips here;
    // the transparent views retain independent 44px gesture targets.
    for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
      ctx.beginPath(); ctx.arc(px, py, 7.5, 0, Math.PI * 2); ctx.fillStyle = '#FFFFFF'; ctx.fill(); ctx.strokeStyle = '#A37C36'; ctx.lineWidth = 2; ctx.stroke();
    }
    this.setData({ handles: [['nw', x, y], ['ne', x + w, y], ['sw', x, y + h], ['se', x + w, y + h]].map(([id, px, py]) => ({ id, style: `left:${px - 22}px;top:${py - 22}px;` })) });
  },
  point(touch, rect) { return { x: (touch.clientX - rect.left - this.viewport.left) / this.viewport.scale, y: (touch.clientY - rect.top - this.viewport.top) / this.viewport.scale }; },
  touchStart(e) {
    if (!this.available() || !e.touches || e.touches.length !== 1) return;
    const touch = e.touches[0], handle = e.currentTarget.dataset.handle || 'move', token = this.gestureToken = (this.gestureToken || 0) + 1;
    wx.createSelectorQuery().select('#cropCanvas').boundingClientRect(rect => {
      if (!rect || token !== this.gestureToken || !this.available()) return;
      const point = this.point(touch, rect), c = this.state.crop;
      if (handle === 'move' && (point.x < c.x || point.x > c.x + c.width || point.y < c.y || point.y > c.y + c.height)) return;
      this.gesture = { point, handle, rect, crop: Object.assign({}, c) };
    }).exec();
  },
  touchMove(e) {
    if (!this.gesture || !this.available()) return;
    if (!e.touches || e.touches.length !== 1) { this.touchCancel(); return; }
    const g = this.gesture, point = this.point(e.touches[0], g.rect);
    this.state.crop = edit.drag(g.crop, g.handle, point.x - g.point.x, point.y - g.point.y, this.bounds(), this.state.ratio, 44 / this.viewport.scale); this.update();
  },
  touchEnd() { this.gestureToken = (this.gestureToken || 0) + 1; this.gesture = null; },
  touchCancel() {
    this.gestureToken = (this.gestureToken || 0) + 1;
    if (this.gesture) { this.state.crop = this.gesture.crop; this.gesture = null; if (!this.disposed) this.update(); }
  },
  async save() {
    if (!this.available() || !this.data.dirty) return; this.touchEnd();
    this.setData({ saving: true, saveError: '' });
    this.task = new SubjectEditTask(this.store, this.id, this.memory);
    try {
      const saved = await this.task.save(async () => {
        // Use an image created by the output canvas itself for device compatibility.
        const image = await new Promise((resolve, reject) => { const img = this.output.createImage(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('图片无法读取，请重试')); img.src = this.sourcePath; });
        const size = edit.render(this.output, image, this.state);
        const result = await platform.call('canvasToTempFilePath', { canvas: this.output, x: 0, y: 0, width: size.width, height: size.height, destWidth: size.width, destHeight: size.height, fileType: 'png' });
        return result.tempFilePath;
      }, this.data.source === 'original' ? 'original' : this.memory.kind);
      if (saved && !this.disposed) { this.setData({ dirty: false }); platform.unloadGuard(false); platform.toast('图片已更新'); platform.back(); }
    } catch (error) { if (!this.disposed) this.setData({ saveError: platform.message(error, '图片未保存，请重试；原物件已保留') }); }
    finally { if (!this.disposed) this.setData({ saving: false }); }
  },
  async back() {
    if (this.data.dirty || this.data.saving) {
      const result = await platform.call('showModal', { title: '放弃本次图片调整？', content: '未保存的裁剪和修正会丢失，已保存的记忆仍会保留。', confirmText: '放弃调整', cancelText: '继续编辑' });
      if (!result.confirm || this.disposed) return;
    }
    if (this.task) await this.task.cancel();
    platform.unloadGuard(false); platform.back();
  }
});
