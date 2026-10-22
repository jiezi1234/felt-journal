const renderer = require('../../core/renderer');
const geometry = require('../../core/geometry');
const B = require('../../core/config').board;
const stickerMotion = require('../../core/sticker-motion');
const viewport = require('../../core/board-viewport');
const snapshots = require('../../services/board-snapshot');
const boardActions = require('../../core/board-actions');
const swipe = require('../../services/board-swipe');
Component({
  properties: { model: { type: Object, value: null }, layout: String, editable: Boolean, canEdit: Boolean, selected: String, covered: Boolean, landingId: String, reportGestures: Boolean, floatingControls: Object, allowSwipe: Boolean, swipePrevious: Object, swipeNext: Object, showActions: Boolean, actionsDisabled: Boolean, canAdd: Boolean, canUndo: Boolean, canBringToFront: Boolean, interactive: { type: Boolean, value: true } },
  data: { height: 210, width: 0, topSpace: 0, canvasHeight: 210, handles: [], actions: [], swipeActive: false, imageError: false, snapshot: '', snapshotA:'', snapshotB:'', snapshotSlot:'a', snapshotVisible:false, canvasHidden:false },
  observers: { 'model, editable, selected, landingId': function () { this.refresh(); if (this.data.layout) wx.nextTick(() => this.measure()); },
    'covered, interactive': function () {
      if (this.data.covered || !this.data.interactive) swipe.cancel(this);
      snapshots.cover(this);
      if (!this.data.covered) { this.pickupReturn = null; this.pickupId = ''; this.finishPickupSnapshot(false); }
      if (this.data.covered || !this.data.interactive) this.touchCancel(); else this.refresh();
    }, 'swipePrevious, swipeNext, allowSwipe': function () { swipe.warm(this); },
    'showActions, actionsDisabled, canAdd, canUndo, canBringToFront, floatingControls': function () { this.refresh(); }, layout() { this.measure(); } },
  lifetimes: { ready() { this.measure(); }, detached() { this.dead = true; swipe.dispose(this); snapshots.dispose(this); this.clearGesture(); this.finishPickupSnapshot(false); } },
  pageLifetimes: { resize() { swipe.cancel(this); this.touchCancel(); this.measure(); }, hide() { swipe.cancel(this); this.touchCancel(); }, show() { if (this.canvas) this.refresh(); } },
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
        const info = wx.getSystemInfoSync(), dpr = info.pixelRatio || 2;
        this.bottomInset = info.safeArea ? Math.max(0, info.screenHeight - info.safeArea.bottom) : 0;
        this.compactFloating = info.windowWidth <= 350;
        this.canvas.width = Math.round(width * dpr); this.canvas.height = Math.round((height + topSpace) * dpr);
        this.setData({ height, width, topSpace, canvasHeight: height + topSpace }, () => this.refresh());
      });
    },
    async refresh() {
      if (!this.canvas || !this.data.model || this.dead || swipe.hold(this)) return;
      const version = this.version = (this.version || 0) + 1, model = this.dragModel || this.data.model;
      try {
        this.images = await renderer.loadImages(this.canvas, model.items || [], this.images, false);
        if (version !== this.version || this.dead) return;
        swipe.beforePaint(this);
        const dimensions = this.dimensions || B;
        const display = viewport.present(model, this.screenWidth, this.data.height).model;
        this.displayModel = display;
        const bounds = renderer.frame(dimensions), sy = this.canvas.height / bounds.height;
        const ctx = this.canvas.getContext('2d'); ctx.setTransform(this.canvas.width / dimensions.width, 0, 0, sy, 0, bounds.top * sy);
        const selected = (display.items || []).find(p => p.memoryId === this.data.selected && p.memoryId !== this.pickupId);
        const handles = this.data.editable && selected && !this.data.landingId ? geometry.handles(selected, this.screenWidth, this.data.height) : [];
        const visible = this.data.landingId || this.pickupId ? Object.assign({}, display, { items: display.items.filter(p => p.memoryId !== this.data.landingId && p.memoryId !== this.pickupId) }) : display;
        this.surface = renderer.createSurface(this.canvas, model, dimensions, this.surface);
        renderer.paint(ctx, visible, this.images, this.data.editable && !this.data.landingId && !this.pickupId ? this.data.selected : '', dimensions, this.surface && this.surface.canvas, this.canvas.width / dimensions.width);
        renderer.paintControls(ctx, handles, this.screenWidth);
        const actions = this.actionLayout();
        boardActions.paint(ctx, actions, this.screenWidth, this.gesture && !this.gesture.moved && this.gesture.action, this.data.floatingControls && this.data.floatingControls.hint);
        this.setData({ handles, actions, imageError: (model.items || []).some(p => this.images[p.memory.subjectPath].missing) });
        snapshots.painted(this, version);
        if (!this.data.covered) swipe.warm(this);
        // Native canvas layers can pierce an overlay. Keep the same board visible
        // as a raster while covered, without destroying the canvas or page.
        if (this.data.covered) wx.canvasToTempFilePath({ canvas: this.canvas, fileType: 'png',
          success: result => {
            if (this.dead || !this.data.covered || version !== this.version) return;
            if (this.pickupWait) this.pickupWait.path = result.tempFilePath;
            const returning = this.pickupReturn;
            snapshots.stage(this, result.tempFilePath, () => !this.dead && this.data.covered && version === this.version, !!returning).then(ready => {
              if (this.dead || !this.data.covered || version !== this.version) return;
              if (returning && this.pickupReturn === returning) returning.snapshot = ready;
              if (this.pickupWait && this.pickupWait.path === result.tempFilePath) this.finishPickupSnapshot(!!ready);
              this.landingReady();
            });
          },
          fail: () => { if (!this.dead && this.data.covered && version === this.version) { this.finishPickupSnapshot(false); this.landingReady(); } }
        });
      } catch (_) { if (!this.dead && version === this.version) { this.finishPickupSnapshot(false); this.setData({ imageError: true }); } }
    },
    pickupRect(id) {
      return new Promise(resolve => {
        const timer = setTimeout(() => resolve(null), 500);
        this.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
          clearTimeout(timer);
          const item = this.displayModel && this.displayModel.items.find(p => p.memoryId === id);
          const image = item && this.images && this.images[item.memory.subjectPath];
          resolve(!this.dead && image && !image.missing ? stickerMotion.landingRect(rect, { ...item, memory:image }) : null);
        }).exec();
      });
    },
    async preparePickup(id) {
      this.touchCancel();
      const rect = await this.pickupRect(id);
      if (!rect || this.dead || !this.canvas || this.data.covered) return null;
      const path = await new Promise(resolve => {
        let finished = false;
        const done = path => { if (!finished) { finished = true; clearTimeout(timer); resolve(path); } };
        const timer = setTimeout(() => done(null), 600);
        wx.canvasToTempFilePath({ canvas:this.canvas, fileType:'png', success:r => done(r.tempFilePath), fail:() => done(null) });
      });
      if (!path || this.dead || this.data.covered) return null;
      const ready = await snapshots.stage(this, path, () => !this.dead && !this.data.covered);
      return ready && !this.data.covered ? { rect, id } : null;
    },
    preparePickupReturn() {
      if (this.pickupReturn) return this.pickupReturn.ready;
      const returning = {};
      returning.ready = this.setPickupHidden('', returning);
      return returning.ready;
    },
    async commitPickupReturn() {
      const returning = this.pickupReturn;
      if (!returning) return this.setPickupHidden('');
      const ready = await returning.ready;
      if (this.dead || this.pickupReturn !== returning || !this.data.covered) return false;
      if (ready && await snapshots.commit(this, returning.snapshot)) {
        if (this.pickupReturn === returning) this.pickupReturn = null;
        return true;
      }
      // Failed or invalidated preloads retain the previous frame and use the
      // normal restore handshake instead of exposing an undecoded image.
      return this.setPickupHidden('');
    },
    setPickupHidden(id, returning = null) {
      this.finishPickupSnapshot(false);
      this.pickupReturn = returning;
      this.pickupId = id || '';
      if (this.dead) return Promise.resolve(false);
      if (!this.data.covered) { this.pickupId = ''; this.refresh(); return Promise.resolve(false); }
      return new Promise(resolve => {
        this.pickupWait = { resolve, id:this.pickupId, timer:setTimeout(() => this.finishPickupSnapshot(false), 900) };
        this.refresh();
      });
    },
    snapshotLoaded(e) { snapshots.loaded(this, e); },
    snapshotFailed(e) { snapshots.failed(this, e); },
    finishPickupSnapshot(ok) {
      const wait = this.pickupWait; if (!wait) return;
      this.pickupWait = null; clearTimeout(wait.timer); wait.resolve(ok);
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
    actionLayout() { return boardActions.layout(this.screenWidth, this.data.height, { ...this.data, bottomInset:this.bottomInset || 0, compactFloating:this.compactFloating, dragging: !!this.dragModel || !!this.swipeMotion }); },
    actionAt(touch) { return boardActions.hit(this.actionLayout(), this.localPoint(touch)); },
    actionTap(e) {
      const action = e.currentTarget.dataset.action;
      if (this.actionTapBlock && this.actionTapBlock.action === action && Date.now() < this.actionTapBlock.until) return;
      const target = this.actionLayout().find(a => a.action === action);
      if (target && !target.disabled) this.triggerEvent('boardaction', { action });
    },
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
    swipeOffset(g) {
      // A selected object, long press, handle or floating action owns its entire
      // gesture. Only a horizontal browse gesture may turn the theme board.
      if (!this.data.allowSwipe || this.data.landingId || !g || !g.moved || g.long || g.draggable || g.next || g.control || g.action || g.axis !== 'x') return 0;
      const start = this.localPoint(g.touch), end = this.localPoint(g.lastTouch);
      if (!start || !end) return 0;
      const dx = end.x - start.x, dy = end.y - start.y;
      return Math.abs(dx) >= 52 && Math.abs(dx) > Math.abs(dy) * 1.5 ? (dx < 0 ? 1 : -1) : 0;
    },
    beginGesture(e, buttonOp) {
      if (this.swipeMotion) return;
      this.clearGesture(); this.controlTapBlock = null;
      if (this.dead || this.data.covered || !this.data.interactive || !this.data.model || e.touches.length !== 1) return;
      if (buttonOp && !this.canControl()) return;
      const touch = e.touches[0], token = this.gestureToken;
      const g = this.gesture = { touch, lastTouch: touch, moved: false, long: false, pending: true, button: !!buttonOp, control: buttonOp, selection: this.data.selected };
      this.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
        if (!rect || this.dead || token !== this.gestureToken) return;
        this.rect = rect;
        const point = this.point(touch); if (!point) { this.clearGesture(); return; }
        const action = !buttonOp && this.actionAt(touch);
        if (action) {
          Object.assign(g, { action: action.action, pending: false });
          if (g.ended) this.touchEnd(g.endEvent); else this.refresh();
          return;
        }
        // Both DOM and native canvas touches enter the same drag state machine.
        const control = buttonOp ? { op: buttonOp } : this.controlAt(touch);
        if (control) {
          if (!this.canControl() || this.data.selected !== g.selection) { this.touchCancel(); return; }
          const item = this.data.model.items.find(p => p.memoryId === g.selection);
          if (!item) { this.touchCancel(); return; }
          const displayItem = viewport.toDisplay(item, this.screenWidth, this.data.height);
          const s = this.screenWidth / B.width;
          Object.assign(g, { control: control.op, item, displayItem, pending: false,
            center: { x: (B.inset + displayItem.x) * s, y: (B.inset + displayItem.y) * s } });
          if (g.lastTouch !== touch) this.touchMove({ touches: [g.lastTouch] });
          if (g.ended) this.touchEnd(g.endEvent);
          return;
        }
        const hit = ((this.displayModel || this.data.model).items || []).slice().reverse().find(p => geometry.hit(p, point.x, point.y));
        const item = hit && this.data.model.items.find(p => p.id === hit.id);
        Object.assign(g, { point, item, displayItem: hit, pending: false, draggable: this.data.editable && item && this.data.selected === item.memoryId });
        // Measurement is asynchronous; consume the latest move immediately so
        // a fast gesture follows the finger before the next touch event.
        if (g.lastTouch !== touch) this.touchMove({ touches: [g.lastTouch] });
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
      if (!g.axis && Math.hypot(current.x - start.x, current.y - start.y) > 12) g.axis = Math.abs(current.x - start.x) > Math.abs(current.y - start.y) * 1.5 ? 'x' : 'y';
      if (g.pending) return;
      if (g.action) { if (g.moved) this.refresh(); return; }
      if (g.control) {
        if (!this.canControl() || this.data.selected !== g.selection) { this.touchCancel(); return; }
        if (g.control !== 'remove' && g.moved) {
          const next = geometry.dragControl(g.item, g.control, g.center, start, current);
          if (next) this.previewPlacement(g, viewport.toStored({ ...next, x: g.displayItem.x, y: g.displayItem.y }, this.screenWidth, this.data.height));
        }
        return;
      }
      if (!g.point) return;
      if (this.data.allowSwipe && g.axis === 'x' && !g.long && !g.draggable && !this.data.landingId) { swipe.update(this, current.x - start.x); return; }
      const point = this.point(e.touches[0]), dx = point.x - g.point.x, dy = point.y - g.point.y;
      if (!g.moved || !g.item || !this.data.editable || this.data.selected !== g.item.memoryId || !(g.draggable || g.long)) return;
      const next = viewport.toStored({ ...g.displayItem, x: g.displayItem.x + dx, y: g.displayItem.y + dy }, this.screenWidth, this.data.height);
      this.previewPlacement(g, next);
    },
    previewPlacement(g, next) {
      if (this.data.reportGestures && !g.announced) { g.announced = true; this.triggerEvent('gesturestate', { active: true }); }
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
      if (g && (g.moved || g.control || this.data.allowSwipe) && g.control !== 'remove' && e && e.changedTouches && e.changedTouches.length) {
        this.touchMove({ touches: [e.changedTouches[0]] });
        if (this.gesture !== g) return;
      }
      if (g && g.control) this.controlTapBlock = { op: g.control, until: Date.now() + 700 };
      if (g && g.action) this.actionTapBlock = { action: g.action, until: Date.now() + 700 };
      this.clearGesture();
      if (!g || this.dead || this.data.covered || !this.data.interactive) return;
      if (swipe.release(this, this.swipeOffset(g))) return;
      if (g.action) {
        const target = this.actionAt(e && e.changedTouches && e.changedTouches[0] || g.lastTouch);
        if (!g.moved && target && target.action === g.action && !target.disabled) this.triggerEvent('boardaction', { action: g.action });
      } else if (g.control) {
        if (this.canControl() && this.data.selected === g.selection) {
          if (g.control === 'remove') {
            const end = e && e.changedTouches && e.changedTouches[0] || g.lastTouch;
            const start = this.localPoint(g.touch), finish = this.localPoint(end);
            const control = g.button ? { op: g.control } : this.controlAt(end);
            if (!g.moved && start && finish && Math.hypot(finish.x - start.x, finish.y - start.y) <= 12 && control && control.op === 'remove') {
              this.transform({ currentTarget: { dataset: { op: 'remove' } } });
            }
          } else if (g.next && (['x', 'y', 'width', 'height'].some(key => Math.abs(g.next[key] - g.item[key]) > 0.001) || g.next.verticalAnchor !== g.item.verticalAnchor || Math.abs(((g.next.angle - g.item.angle + 540) % 360) - 180) > 0.001)) {
            this.triggerEvent('change', { placement: g.next });
          }
        }
      } else if (g.next) this.triggerEvent('change', { placement: g.next });
      else if (this.swipeOffset(g)) this.triggerEvent('boardswipe', { offset: this.swipeOffset(g) });
      else if (!g.moved && !g.long) {
        if (g.item) this.triggerEvent('memory', { id: g.item.memoryId });
        else this.triggerEvent(this.data.editable ? 'select' : 'boardtap', { id: '' });
      }
      this.refresh();
    },
    clearGesture() {
      if (this.gesture && this.gesture.announced) this.triggerEvent('gesturestate', { active: false });
      this.gestureToken = (this.gestureToken || 0) + 1; clearTimeout(this.longTimer);
      if (this.previewFrame != null && this.canvas && this.canvas.cancelAnimationFrame) this.canvas.cancelAnimationFrame(this.previewFrame);
      this.previewFrame = null; this.gesture = null; this.dragModel = null;
    },
    touchCancel() {
      if (this.gesture && this.gesture.control) this.controlTapBlock = { op: this.gesture.control, until: Date.now() + 700 };
      if (this.gesture && this.gesture.action) this.actionTapBlock = { action: this.gesture.action, until: Date.now() + 700 };
      this.clearGesture();
      if (this.swipeMotion) { if (this.swipeMotion.phase !== 'committing') swipe.cancel(this, false); return; }
      this.refresh();
    },
    cancelSwipe() { swipe.cancel(this, false); },
    transform(e) {
      if (this.dead || this.data.covered || !this.data.interactive || !this.data.canEdit || !this.data.editable || !this.data.selected || this.data.landingId) return;
      const op = e.currentTarget.dataset.op;
      if (op === 'remove') { this.touchCancel(); this.triggerEvent('remove', { id: this.data.selected }); }
    }
  }
});
