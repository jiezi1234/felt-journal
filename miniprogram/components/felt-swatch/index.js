const felt = require('../../core/felt');
Component({
  properties: { color: String, texture: String, inactive: Boolean },
  observers: {
    'color, texture': function () { this.paint(); },
    inactive(value) { if (!value && !this.dead) wx.nextTick(() => this.measure()); }
  },
  lifetimes: { ready() { this.measure(); }, detached() { this.dead = true; } },
  pageLifetimes: { resize() { this.measure(); } },
  methods: {
    measure() {
      if (this.dead || this.data.inactive) return;
      this.createSelectorQuery().select('#sample').fields({ node: true, size: true }).exec(result => {
        const rect = result[0]; if (this.dead || this.data.inactive || !rect || !rect.node || !rect.width) return;
        this.canvas = rect.node; this.width = rect.width; this.height = rect.height;
        const dpr = Math.min(wx.getSystemInfoSync().pixelRatio || 2, 2);
        this.canvas.width = Math.round(rect.width * dpr); this.canvas.height = Math.round(rect.height * dpr); this.paint();
      });
    },
    paint() {
      if (this.dead || this.data.inactive || !this.canvas) return;
      const ctx = this.canvas.getContext('2d'); ctx.setTransform(this.canvas.width / this.width, 0, 0, this.canvas.height / this.height, 0, 0);
      felt.paintSample(ctx, this.width, this.height, this.data.color, this.data.texture);
    }
  }
});
