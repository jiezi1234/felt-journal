const { subject } = require('../../core/recall-card');
Component({
  properties: { path: String, memoryId: String },
  data: { previewPath: '', pending: false },
  observers: { path() { if (this.canvas) this.render(); } },
  lifetimes: {
    ready() {
      this.createSelectorQuery().select('#subject-canvas').fields({ node: true }).exec(result => {
        if (this.dead) return;
        this.canvas = result && result[0] && result[0].node;
        if (this.canvas) this.render();
      });
    },
    detached() { this.dead = true; this.version = (this.version || 0) + 1; this.canvas = null; clearTimeout(this.renderTimer); }
  },
  methods: {
    render() {
      const canvas = this.canvas, path = this.data.path, id = this.data.memoryId;
      const version = this.version = (this.version || 0) + 1;
      clearTimeout(this.renderTimer);
      this.setData({ previewPath: '', pending: !!path });
      if (!path || !canvas || this.dead) return;
      const current = () => !this.dead && version === this.version && path === this.data.path;
      const fallback = () => { if (current()) { clearTimeout(this.renderTimer); this.setData({ previewPath: '', pending: false }); } };
      // A failed/slow canvas must never leave a valid original photo invisible.
      this.renderTimer = setTimeout(fallback, 1800);
      try {
        canvas.width = 640; canvas.height = 432;
        const image = canvas.createImage();
        image.onload = () => {
          if (!current()) return;
          try {
            const ctx = canvas.getContext('2d');
            ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.clearRect(0, 0, 320, 216);
            subject(ctx, image, { x: 22, y: 16, width: 276, height: 184 });
            wx.canvasToTempFilePath({ canvas, fileType: 'png',
              success: result => { if (current()) { clearTimeout(this.renderTimer); this.setData({ previewPath: result.tempFilePath, pending: false }); } },
              fail: fallback
            });
          } catch (_) { fallback(); }
        };
        image.onerror = () => { if (current()) { fallback(); this.triggerEvent('imageerror', { id, path }); } };
        image.src = path;
      } catch (_) { fallback(); }
    },
    imageFailed(e) {
      const dataset = e.currentTarget.dataset;
      if (this.dead || dataset.path !== this.data.path || dataset.preview !== this.data.previewPath) return;
      // A snapshot decode failure is not a missing user photo: retry its source.
      if (this.data.previewPath) { this.setData({ previewPath: '', pending: false }); return; }
      this.triggerEvent('imageerror', { id: this.data.memoryId, path: this.data.path });
    }
  }
});
