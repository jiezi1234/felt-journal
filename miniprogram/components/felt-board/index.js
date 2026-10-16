const renderer = require('../../core/renderer');
const geometry = require('../../core/geometry');
const B = require('../../core/config').board;
const stickerMotion = require('../../core/sticker-motion');
const viewport = require('../../core/board-viewport');
Component({
  properties: { model: { type: Object, value: null }, layout: String, editable: Boolean, selected: String, covered: Boolean, landingId: String, interactive: { type: Boolean, value: true } },
  data: { height: 210, width: 0, handles: [], imageError: false, snapshot: '' },
  observers: { 'model, editable, selected, covered, landingId': function () { this.refresh(); if (this.data.layout) wx.nextTick(() => this.measure()); }, layout() { this.measure(); } },
  lifetimes: { ready() { this.measure(); }, detached() { this.dead = true; clearTimeout(this.longTimer); } },
  pageLifetimes: { resize() { this.measure(); }, show() { if (this.canvas) this.refresh(); } },
  methods: {
    stop() {},
    measure() {
      this.createSelectorQuery().select('#feltCanvas').fields({ node: true }).select('.board-viewport').boundingClientRect().exec(result => {
        const r = result[0], rect = result[1]; if (this.dead || !r || !r.node || !rect || !rect.width) return;
        const tall = this.data.layout === 'tall' && !this.data.editable;
        const width = this.data.layout === 'fit' && rect.height ? Math.min(rect.width, rect.height * B.width / B.height) : rect.width;
        const height = tall ? Math.max(width * B.height / B.width, rect.height) : width * B.height / B.width;
        if (this.canvas === r.node && Math.abs(this.screenWidth - width) < 0.5 && Math.abs(this.data.height - height) < 0.5) return;
        this.canvas = r.node; this.screenWidth = width;
        this.dimensions = tall ? viewport.present({ items: [] }, width, height).dimensions : B;
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round(height * dpr);
        this.setData({ height, width }, () => this.refresh());
      });
    },
    async refresh() {
      if (!this.canvas || !this.data.model || this.dead) return;
      const version = this.version = (this.version || 0) + 1, model = this.dragModel || this.data.model;
      try {
        this.images = await renderer.loadImages(this.canvas, model.items || [], this.images, false);
        if (version !== this.version || this.dead) return;
        const dimensions = this.dimensions || B;
        const display = dimensions === B ? model : viewport.present(model, this.screenWidth, this.data.height).model;
        this.displayModel = display;
        const ctx = this.canvas.getContext('2d'); ctx.setTransform(this.canvas.width / dimensions.width, 0, 0, this.canvas.height / dimensions.height, 0, 0);
        const selected = (model.items || []).find(p => p.memoryId === this.data.selected);
        const handles = this.data.editable && selected && !this.data.landingId ? geometry.handles(selected, this.screenWidth) : [];
        const visible = this.data.landingId ? Object.assign({}, display, { items: display.items.filter(p => p.memoryId !== this.data.landingId) }) : display;
        renderer.paint(ctx, visible, this.images, this.data.editable && !this.data.landingId ? this.data.selected : '', dimensions);
        renderer.paintControls(ctx, handles, this.screenWidth);
        this.setData({ handles, imageError: (model.items || []).some(p => this.images[p.memory.subjectPath].missing) });
        // Native canvas layers can pierce an overlay. Keep the same board visible
        // as a raster while covered, without destroying the canvas or page.
        if (this.data.covered) wx.canvasToTempFilePath({ canvas: this.canvas, fileType: 'png',
          success: result => { if (!this.dead && this.data.covered && version === this.version) this.setData({ snapshot: result.tempFilePath }, () => this.landingReady()); },
          fail: () => { if (!this.dead && this.data.covered && version === this.version) this.landingReady(); }
        });
      } catch (_) { if (!this.dead && version === this.version) this.setData({ imageError: true }); }
    },
    landingReady() {
      const id = this.data.landingId;
      if (!id || this.dead) return;
      this.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
        if (this.dead || this.data.landingId !== id) return;
        const placement = this.data.model.items.find(item => item.memoryId === id);
        const target = stickerMotion.landingRect(rect, placement);
        if (target) this.triggerEvent('landingready', { id, target });
      }).exec();
    },
    point(touch) { return { x: (touch.clientX - this.rect.left) * B.width / this.screenWidth - B.inset, y: (touch.clientY - this.rect.top) * B.width / this.screenWidth - B.inset }; },
    touchStart(e) {
      if (this.data.covered || !this.data.interactive || !this.data.model || !e.touches[0]) return;
      const touch = e.touches[0]; this.gestureToken = (this.gestureToken || 0) + 1; const token = this.gestureToken;
      this.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
        if (!rect || token !== this.gestureToken) return;
        this.rect = rect;
        const point = this.point(touch), item = ((this.displayModel || this.data.model).items || []).slice().reverse().find(p => geometry.hit(p, point.x, point.y));
        this.gesture = { point, item, moved: false, long: false };
        if (this.data.editable && item) {
          this.triggerEvent('select', { id: item.memoryId });
          this.longTimer = setTimeout(() => { if (this.gesture && !this.gesture.moved) { this.gesture.long = true; this.triggerEvent('memory', { id: item.memoryId }); } }, 650);
        }
      }).exec();
    },
    touchMove(e) {
      const g = this.gesture; if (!g || !e.touches[0]) return;
      const point = this.point(e.touches[0]), dx = point.x - g.point.x, dy = point.y - g.point.y;
      if (Math.hypot(dx, dy) * this.screenWidth / B.width > 6) { g.moved = true; clearTimeout(this.longTimer); }
      if (!g.moved || !g.item || !this.data.editable || g.long) return;
      const next = geometry.fit(Object.assign({}, g.item, { x: g.item.x + dx, y: g.item.y + dy }));
      g.next = next; this.dragModel = Object.assign({}, this.data.model, { items: this.data.model.items.map(p => p.id === next.id ? next : p) }); this.refresh();
    },
    touchEnd() {
      this.gestureToken = (this.gestureToken || 0) + 1; clearTimeout(this.longTimer);
      const g = this.gesture; this.gesture = null; this.dragModel = null; if (!g) return;
      if (g.next) this.triggerEvent('change', { placement: g.next });
      else if (!g.moved && !g.long) {
        if (this.data.editable) this.triggerEvent('select', { id: g.item ? g.item.memoryId : '' });
        else this.triggerEvent(g.item ? 'memory' : 'boardtap', { id: g.item ? g.item.memoryId : '' });
      }
      this.refresh();
    },
    touchCancel() { this.gestureToken = (this.gestureToken || 0) + 1; clearTimeout(this.longTimer); this.gesture = null; this.dragModel = null; this.refresh(); },
    transform(e) { this.triggerEvent('transform', { op: e.currentTarget.dataset.op }); }
  }
});
