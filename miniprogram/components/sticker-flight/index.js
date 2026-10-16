const peel = require('../../core/sticker-peel');
Component({
  properties: { flight: Object },
  data: { painted: false, phase: 'preparing' },
  observers: { flight() { this.startLanding(); } },
  lifetimes: {
    ready() {
      this.createSelectorQuery().select('#flight-canvas').fields({ node: true, size: true, rect: true }).exec(results => {
        if (this.dead) return;
        const view = results[0]; if (!view || !view.node || !view.width) return this.failed();
        this.canvas = view.node; this.width = view.width; this.height = view.height;
        this.origin = { left: view.left || 0, top: view.top || 0 };
        this.dpr = Math.min(2, wx.getSystemInfoSync().pixelRatio || 2);
        this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
        this.ctx = this.canvas.getContext('2d');
        const image = this.canvas.createImage();
        image.onload = () => {
          if (this.dead) return;
          this.image = image;
          if (wx.createOffscreenCanvas) {
            try { this.shadowLayer = wx.createOffscreenCanvas({ type: '2d', width: this.canvas.width, height: this.canvas.height }); } catch (_) {}
          }
          this.setData({ phase: 'peeling' });
          this.runFrames(1000, progress => this.draw(this.data.flight.source, peel.ease(progress), false), () => {
            this.setData({ phase: 'lifted' });
            this.timer = setTimeout(() => { if (!this.dead) { this.prepared = true; this.triggerEvent('peeled', { token: this.data.flight.token }); this.startLanding(); } }, 500);
          });
        };
        image.onerror = () => this.failed(); image.src = this.data.flight.path;
      });
    },
    detached() { this.dead = true; clearTimeout(this.timer); if (this.canvas && this.frame) this.canvas.cancelAnimationFrame(this.frame); }
  },
  methods: {
    stop() {},
    runFrames(duration, draw, done) {
      const start = Date.now();
      const tick = () => {
        if (this.dead) return;
        const progress = Math.min(1, (Date.now() - start) / duration);
        try { draw(progress); } catch (_) { this.failed(); return; }
        if (!this.data.painted) this.setData({ painted: true });
        if (progress < 1) this.frame = this.canvas.requestAnimationFrame(tick); else done();
      };
      tick();
    },
    draw(rect, progress, landing) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.width, this.height);
      const amplitude = Math.min(rect.width, rect.height) * .16;
      const mesh = (context, shadow) => {
        context.save(); context.translate(rect.left - this.origin.left + rect.width / 2, rect.top - this.origin.top + rect.height / 2); context.rotate((rect.angle || 0) * Math.PI / 180); context.translate(-rect.width / 2, -rect.height / 2);
        peel.paint(context, this.image, rect.width, rect.height, progress, landing, amplitude, shadow); context.restore();
      };
      mesh(ctx, false);
      // Apply translucency once to the complete mesh, so tessellation overlap
      // cannot produce repeated highlight or shadow stripes.
      ctx.save(); ctx.globalCompositeOperation = 'source-atop'; ctx.globalAlpha = Math.floor(Math.sin(Math.PI * progress) * 34) / 255;
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, this.width, this.height); ctx.restore();
      if (!this.shadowLayer) return;
      const shadow = this.shadowLayer.getContext('2d');
      shadow.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); shadow.clearRect(0, 0, this.width, this.height);
      mesh(shadow, true);
      shadow.save(); shadow.globalCompositeOperation = 'source-in'; shadow.fillStyle = '#000000'; shadow.fillRect(0, 0, this.width, this.height); shadow.restore();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-over'; ctx.globalAlpha = 62 / 255; ctx.drawImage(this.shadowLayer, 0, 0);
      ctx.restore();
    },
    startLanding() {
      const flight = this.data.flight;
      if (!this.prepared || !flight || !flight.target || this.landing || this.dead) return;
      this.landing = true; this.setData({ phase: 'flying' });
      this.runFrames(1000, progress => {
        const p = peel.ease(progress), rect = {};
        ['left', 'top', 'width', 'height'].forEach(key => { rect[key] = flight.source[key] + (flight.target[key] - flight.source[key]) * p; });
        rect.angle = (flight.target.angle || 0) * p;
        this.draw(rect, p, true);
      }, () => { this.setData({ phase: 'landed' }); this.timer = setTimeout(() => this.failed(), 120); });
    },
    failed() { if (!this.dead && !this.finished && this.data.flight) { this.finished = true; this.triggerEvent('landed', { token: this.data.flight.token }); } }
  }
});
