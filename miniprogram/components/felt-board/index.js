const renderer = require('../../core/renderer');
const geometry = require('../../core/geometry');
const B = require('../../core/config').board;
const stickerMotion = require('../../core/sticker-motion');
const viewport = require('../../core/board-viewport');
Component({
  properties: { model: { type: Object, value: null }, layout: String, editable: Boolean, canEdit: Boolean, selected: String, covered: Boolean, landingId: String, interactive: { type: Boolean, value: true } },
  data: { height: 210, width: 0, handles: [], imageError: false, snapshot: '' },
  observers: { 'model, editable, selected, covered, landingId': function () { this.refresh(); if (this.data.layout) wx.nextTick(() => this.measure()); },
    'covered, interactive': function () { if (this.data.covered || !this.data.interactive) this.touchCancel(); }, layout() { this.measure(); } },
  lifetimes: { ready() { this.measure(); }, detached() { this.dead = true; this.clearGesture(); } },
  pageLifetimes: { resize() { this.touchCancel(); this.measure(); }, hide() { this.touchCancel(); }, show() { if (this.canvas) this.refresh(); } },
  methods: {
    stop() {},
    measure() {
      this.createSelectorQuery().select('#feltCanvas').fields({ node: true }).select('.board-viewport').boundingClientRect().exec(result => {
        const r = result[0], rect = result[1]; if (this.dead || !r || !r.node || !rect || !rect.width) return;
        const tall = this.data.layout === 'tall';
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
        const selected = (display.items || []).find(p => p.memoryId === this.data.selected);
        const handles = this.data.editable && selected && !this.data.landingId ? geometry.handles(selected, this.screenWidth, this.data.height) : [];
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
        const placement = (this.displayModel || this.data.model).items.find(item => item.memoryId === id);
        const target = stickerMotion.landingRect(rect, placement);
        if (target) this.triggerEvent('landingready', { id, target });
      }).exec();
    },
    point(touch) { return { x: (touch.clientX - this.rect.left) * B.width / this.screenWidth - B.inset, y: (touch.clientY - this.rect.top) * B.width / this.screenWidth - B.inset }; },
    touchStart(e) {
      this.clearGesture();
      if (this.dead || this.data.covered || !this.data.interactive || !this.data.model || e.touches.length !== 1) return;
      const touch = e.touches[0], token = this.gestureToken;
      const g = this.gesture = { touch, moved: false, long: false, pending: true };
      this.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
        if (!rect || this.dead || token !== this.gestureToken) return;
        this.rect = rect;
        const point = this.point(touch), hit = ((this.displayModel || this.data.model).items || []).slice().reverse().find(p => geometry.hit(p, point.x, point.y));
        const item = hit && this.data.model.items.find(p => p.id === hit.id);
        Object.assign(g, { point, item, pending: false, draggable: this.data.editable && item && this.data.selected === item.memoryId });
        if (g.ended) { this.touchEnd(); return; }
        if (item && !g.moved) {
          this.longTimer = setTimeout(() => {
            if (this.dead || token !== this.gestureToken || g.moved || this.data.covered || !this.data.interactive) return;
            // Consume the press before notifying the page, so release cannot open a card.
            g.long = true;
            if (this.data.canEdit) this.triggerEvent('edititem', { id: item.memoryId });
          }, 650);
        }
      }).exec();
    },
    touchMove(e) {
      if (e.touches.length !== 1 || this.data.covered || !this.data.interactive) { this.touchCancel(); return; }
      const g = this.gesture; if (!g) return;
      if (Math.hypot(e.touches[0].clientX - g.touch.clientX, e.touches[0].clientY - g.touch.clientY) > 6) { g.moved = true; clearTimeout(this.longTimer); }
      if (!g.point) return;
      const point = this.point(e.touches[0]), dx = point.x - g.point.x, dy = point.y - g.point.y;
      if (!g.moved || !g.item || !this.data.editable || this.data.selected !== g.item.memoryId || !(g.draggable || g.long)) return;
      const ratio = this.data.layout === 'tall' ? viewport.verticalRatio(this.screenWidth, this.data.height) : 1;
      const next = geometry.fit(Object.assign({}, g.item, { x: g.item.x + dx, y: g.item.y + dy / ratio }));
      g.next = next; this.dragModel = Object.assign({}, this.data.model, { items: this.data.model.items.map(p => p.id === next.id ? next : p) }); this.refresh();
    },
    touchEnd() {
      const g = this.gesture;
      if (g && g.pending) { g.ended = true; return; }
      this.clearGesture();
      if (!g || this.dead || this.data.covered || !this.data.interactive) return;
      if (g.next) this.triggerEvent('change', { placement: g.next });
      else if (!g.moved && !g.long) {
        if (g.item) this.triggerEvent('memory', { id: g.item.memoryId });
        else this.triggerEvent(this.data.editable ? 'select' : 'boardtap', { id: '' });
      }
      this.refresh();
    },
    clearGesture() { this.gestureToken = (this.gestureToken || 0) + 1; clearTimeout(this.longTimer); this.gesture = null; this.dragModel = null; },
    touchCancel() { this.clearGesture(); this.refresh(); },
    transform(e) { this.triggerEvent('transform', { op: e.currentTarget.dataset.op }); }
  }
});
