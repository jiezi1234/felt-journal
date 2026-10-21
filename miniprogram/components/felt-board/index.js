const renderer = require('../../core/renderer');
const geometry = require('../../core/geometry');
const B = require('../../core/config').board;
const stickerMotion = require('../../core/sticker-motion');
const viewport = require('../../core/board-viewport');
Component({
  properties: { model: { type: Object, value: null }, layout: String, editable: Boolean, canEdit: Boolean, selected: String, covered: Boolean, landingId: String, interactive: { type: Boolean, value: true } },
  data: { height: 210, width: 0, topSpace: 0, canvasHeight: 210, handles: [], imageError: false, snapshot: '' },
  observers: { 'model, editable, selected, covered, landingId': function () { this.refresh(); if (this.data.layout) wx.nextTick(() => this.measure()); },
    'covered, interactive': function () { if (this.data.covered || !this.data.interactive) this.touchCancel(); }, layout() { this.measure(); } },
  lifetimes: { ready() { this.measure(); }, detached() { this.dead = true; this.clearGesture(); } },
  pageLifetimes: { resize() { this.touchCancel(); this.measure(); }, hide() { this.touchCancel(); }, show() { if (this.canvas) this.refresh(); } },
  methods: {
    exportViewport() { return this.dimensions ? { width: this.dimensions.width, height: this.dimensions.height } : null; },
    stop() {},
    measure() {
      this.createSelectorQuery().select('#feltCanvas').fields({ node: true }).select('.board-viewport').boundingClientRect().exec(result => {
        const r = result[0], rect = result[1]; if (this.dead || !r || !r.node || !rect || !rect.width) return;
        const tall = this.data.layout === 'tall';
        const width = this.data.layout === 'fit' && rect.height ? Math.min(rect.width, rect.height * B.width / (B.height + B.overhang)) : rect.width;
        const topSpace = width * B.overhang / B.width;
        const height = tall ? Math.max(width * B.height / B.width, rect.height - topSpace) : width * B.height / B.width;
        if (this.canvas === r.node && Math.abs(this.screenWidth - width) < 0.5 && Math.abs(this.data.height - height) < 0.5) return;
        this.canvas = r.node; this.screenWidth = width;
        this.dimensions = tall ? viewport.present({ items: [] }, width, height).dimensions : B;
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round((height + topSpace) * dpr);
        this.setData({ height, width, topSpace, canvasHeight: height + topSpace }, () => this.refresh());
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
        const bounds = renderer.frame(dimensions), sy = this.canvas.height / bounds.height;
        const ctx = this.canvas.getContext('2d'); ctx.setTransform(this.canvas.width / dimensions.width, 0, 0, sy, 0, bounds.top * sy);
        const selected = (display.items || []).find(p => p.memoryId === this.data.selected);
        const handles = this.data.editable && selected && !this.data.landingId ? geometry.handles(selected, this.screenWidth, this.data.height) : [];
        const visible = this.data.landingId ? Object.assign({}, display, { items: display.items.filter(p => p.memoryId !== this.data.landingId) }) : display;
        this.surface = renderer.createSurface(this.canvas, model, dimensions, this.surface);
        renderer.paint(ctx, visible, this.images, this.data.editable && !this.data.landingId ? this.data.selected : '', dimensions, this.surface && this.surface.canvas, this.canvas.width / dimensions.width);
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
    localPoint(touch) {
      if (!touch) return null;
      // View touches use viewport coordinates; native CanvasTouch uses local x/y.
      const rect = this.rect || { left: 0, top: 0 };
      if (Number.isFinite(touch.clientX) && Number.isFinite(touch.clientY)) return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
      if (Number.isFinite(touch.x) && Number.isFinite(touch.y)) return { x: touch.x, y: touch.y - (this.data.topSpace || 0) };
      return null;
    },
    point(touch) { const p = this.localPoint(touch); return p && { x: p.x * B.width / this.screenWidth - B.inset, y: p.y * B.width / this.screenWidth - B.inset }; },
    controlAt(touch) {
      if (this.dead || this.data.covered || !this.data.interactive || !this.data.canEdit || !this.data.editable || !this.data.selected || this.data.landingId) return null;
      const p = this.localPoint(touch), handle = p && geometry.hitControl(this.data.handles, p.x, p.y);
      return handle && handle.memoryId === this.data.selected ? handle : null;
    },
    controlStart(e) {
      const op = e.currentTarget.dataset.op;
      if (['rotate', 'resize', 'remove'].includes(op)) this.beginGesture(e, op);
    },
    controlTap(e) {
      const block = this.controlTapBlock;
      if (block && block.op === e.currentTarget.dataset.op && Date.now() < block.until) return;
      // Size and angle are continuous drag gestures. A tap only deletes.
      this.transform(e);
    },
    touchStart(e) { this.beginGesture(e); },
    canControl() {
      return !this.dead && !this.data.covered && this.data.interactive && this.data.canEdit && this.data.editable && !!this.data.selected && !this.data.landingId;
    },
    beginGesture(e, buttonOp) {
      this.clearGesture(); this.controlTapBlock = null;
      if (this.dead || this.data.covered || !this.data.interactive || !this.data.model || e.touches.length !== 1) return;
      if (buttonOp && !this.canControl()) return;
      const touch = e.touches[0], token = this.gestureToken;
      const g = this.gesture = { touch, lastTouch: touch, moved: false, long: false, pending: true, button: !!buttonOp, control: buttonOp, selection: this.data.selected };
      this.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
        if (!rect || this.dead || token !== this.gestureToken) return;
        this.rect = rect;
        const point = this.point(touch); if (!point) { this.clearGesture(); return; }
        // Both DOM and native canvas touches enter the same drag state machine.
        const control = buttonOp ? { op: buttonOp } : this.controlAt(touch);
        if (control) {
          if (!this.canControl() || this.data.selected !== g.selection) { this.touchCancel(); return; }
          const item = this.data.model.items.find(p => p.memoryId === g.selection);
          if (!item) { this.touchCancel(); return; }
          const ratio = this.data.layout === 'tall' ? viewport.verticalRatio(this.screenWidth, this.data.height) : 1;
          const s = this.screenWidth / B.width;
          Object.assign(g, { control: control.op, item, pending: false,
            center: { x: (B.inset + item.x) * s, y: (B.inset + item.y * ratio) * s } });
          if (g.lastTouch !== touch) this.touchMove({ touches: [g.lastTouch] });
          if (g.ended) this.touchEnd(g.endEvent);
          return;
        }
        const hit = ((this.displayModel || this.data.model).items || []).slice().reverse().find(p => geometry.hit(p, point.x, point.y));
        const item = hit && this.data.model.items.find(p => p.id === hit.id);
        Object.assign(g, { point, item, pending: false, draggable: this.data.editable && item && this.data.selected === item.memoryId });
        if (g.ended) { this.touchEnd(g.endEvent); return; }
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
      const touch = e.touches[0];
      if (g.touch.identifier != null && touch.identifier != null && g.touch.identifier !== touch.identifier) { this.touchCancel(); return; }
      g.lastTouch = touch;
      const start = this.localPoint(g.touch), current = this.localPoint(e.touches[0]);
      if (!start || !current) { this.touchCancel(); return; }
      const threshold = g.control === 'remove' ? 12 : g.control ? 2 : 6;
      if (Math.hypot(current.x - start.x, current.y - start.y) > threshold) { g.moved = true; clearTimeout(this.longTimer); }
      if (g.pending) return;
      if (g.control) {
        if (!this.canControl() || this.data.selected !== g.selection) { this.touchCancel(); return; }
        if (g.control !== 'remove' && g.moved) {
          const next = geometry.dragControl(g.item, g.control, g.center, start, current);
          if (next) this.previewPlacement(g, next);
        }
        return;
      }
      if (!g.point) return;
      const point = this.point(e.touches[0]), dx = point.x - g.point.x, dy = point.y - g.point.y;
      if (!g.moved || !g.item || !this.data.editable || this.data.selected !== g.item.memoryId || !(g.draggable || g.long)) return;
      const ratio = this.data.layout === 'tall' ? viewport.verticalRatio(this.screenWidth, this.data.height) : 1;
      const next = geometry.fit(Object.assign({}, g.item, { x: g.item.x + dx, y: g.item.y + dy / ratio }));
      this.previewPlacement(g, next);
    },
    previewPlacement(g, next) {
      g.next = next;
      this.dragModel = Object.assign({}, this.data.model, { items: this.data.model.items.map(p => p.id === next.id ? next : p) });
      // Touch events can arrive faster than the display refreshes. Keep the
      // latest geometry immediately, and paint at most once per native frame.
      if (!this.canvas || !this.canvas.requestAnimationFrame) { this.refresh(); return; }
      if (this.previewFrame != null) return;
      this.previewFrame = this.canvas.requestAnimationFrame(() => {
        this.previewFrame = null;
        if (!this.dead && this.dragModel) this.refresh();
      });
    },
    touchEnd(e) {
      const g = this.gesture;
      if (g && g.pending) { g.ended = true; g.endEvent = e; return; }
      if (g && (g.moved || g.control) && g.control !== 'remove' && e && e.changedTouches && e.changedTouches.length) {
        this.touchMove({ touches: [e.changedTouches[0]] });
        if (this.gesture !== g) return;
      }
      if (g && g.control) this.controlTapBlock = { op: g.control, until: Date.now() + 700 };
      this.clearGesture();
      if (!g || this.dead || this.data.covered || !this.data.interactive) return;
      if (g.control) {
        if (this.canControl() && this.data.selected === g.selection) {
          if (g.control === 'remove') {
            const end = e && e.changedTouches && e.changedTouches[0] || g.lastTouch;
            const start = this.localPoint(g.touch), finish = this.localPoint(end);
            const control = g.button ? { op: g.control } : this.controlAt(end);
            if (!g.moved && start && finish && Math.hypot(finish.x - start.x, finish.y - start.y) <= 12 && control && control.op === 'remove') {
              this.transform({ currentTarget: { dataset: { op: 'remove' } } });
            }
          } else if (g.next && (['x', 'y', 'width', 'height'].some(key => Math.abs(g.next[key] - g.item[key]) > 0.001) || Math.abs(((g.next.angle - g.item.angle + 540) % 360) - 180) > 0.001)) {
            this.triggerEvent('change', { placement: g.next });
          }
        }
      } else if (g.next) this.triggerEvent('change', { placement: g.next });
      else if (!g.moved && !g.long) {
        if (g.item) this.triggerEvent('memory', { id: g.item.memoryId });
        else this.triggerEvent(this.data.editable ? 'select' : 'boardtap', { id: '' });
      }
      this.refresh();
    },
    clearGesture() {
      this.gestureToken = (this.gestureToken || 0) + 1; clearTimeout(this.longTimer);
      if (this.previewFrame != null && this.canvas && this.canvas.cancelAnimationFrame) this.canvas.cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null; this.gesture = null; this.dragModel = null;
    },
    touchCancel() {
      if (this.gesture && this.gesture.control) this.controlTapBlock = { op: this.gesture.control, until: Date.now() + 700 };
      this.clearGesture(); this.refresh();
    },
    transform(e) {
      if (this.dead || this.data.covered || !this.data.interactive || !this.data.canEdit || !this.data.editable || !this.data.selected || this.data.landingId) return;
      const op = e.currentTarget.dataset.op;
      if (op === 'remove') { this.touchCancel(); this.triggerEvent('remove', { id: this.data.selected }); }
    }
  }
});
