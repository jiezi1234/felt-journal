const renderer = require('../../core/renderer');
const geometry = require('../../core/geometry');
const B = require('../../core/config').board;
Component({
  properties: { model: { type: Object, value: null }, editable: Boolean, selected: String, interactive: { type: Boolean, value: true } },
  data: { height: 210, handles: [], imageError: false },
  observers: { 'model, editable, selected': function () { this.refresh(); } },
  lifetimes: { ready() { this.measure(); }, detached() { this.dead = true; clearTimeout(this.longTimer); } },
  pageLifetimes: { resize() { this.measure(); }, show() { if (this.canvas) this.refresh(); } },
  methods: {
    stop() {},
    measure() {
      this.createSelectorQuery().select('#feltCanvas').fields({ node: true, size: true, rect: true }).exec(result => {
        const r = result[0]; if (!r || !r.node || !r.width) return;
        this.canvas = r.node; this.screenWidth = r.width;
        const dpr = wx.getSystemInfoSync().pixelRatio || 2;
        this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.width * B.height / B.width * dpr);
        this.setData({ height: r.width * B.height / B.width }, () => this.refresh());
      });
    },
    async refresh() {
      if (!this.canvas || !this.data.model || this.dead) return;
      const version = this.version = (this.version || 0) + 1, model = this.dragModel || this.data.model;
      try {
        this.images = await renderer.loadImages(this.canvas, model.items || [], this.images, false);
        if (version !== this.version || this.dead) return;
        const ctx = this.canvas.getContext('2d'); ctx.setTransform(this.canvas.width / B.width, 0, 0, this.canvas.height / B.height, 0, 0);
        const selected = (model.items || []).find(p => p.memoryId === this.data.selected);
        const handles = this.data.editable && selected ? geometry.handles(selected, this.screenWidth) : [];
        renderer.paint(ctx, model, this.images, this.data.editable ? this.data.selected : '');
        renderer.paintControls(ctx, handles, this.screenWidth);
        this.setData({ handles, imageError: (model.items || []).some(p => this.images[p.memory.subjectPath].missing) });
      } catch (_) { this.setData({ imageError: true }); }
    },
    point(touch) { return { x: (touch.clientX - this.rect.left) * B.width / this.screenWidth - B.inset, y: (touch.clientY - this.rect.top) * B.width / this.screenWidth - B.inset }; },
    touchStart(e) {
      if (!this.data.interactive || !this.data.model || !e.touches[0]) return;
      const touch = e.touches[0]; this.gestureToken = (this.gestureToken || 0) + 1; const token = this.gestureToken;
      this.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
        if (!rect || token !== this.gestureToken) return;
        this.rect = rect;
        const point = this.point(touch), item = (this.data.model.items || []).slice().reverse().find(p => geometry.hit(p, point.x, point.y));
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
