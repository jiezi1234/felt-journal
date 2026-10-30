const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const recall = require('../../core/memory-recall');
const platform = require('../../services/platform');
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { active: Boolean, editing: Boolean, recording: Boolean, blocked: Boolean, open: Boolean },
  data: { item: null, closing: false, hiddenCount: 0, error: '', canNext: false, turn: false, subjectActive: false, subjectPath: '', subjectPreview: '' },
  observers: {
    'active, editing, recording, blocked, open': function () { if (this.store) this.sync(); }
  },
  lifetimes: {
    attached() {
      this.store = getStore(); this.visible = true; this.failed = {}; this.rotateOnResume = true;
      let raw; try { raw = wx.getStorageSync(recall.KEY); } catch (_) { /* Optional local preferences. */ }
      this.prefs = recall.preferences(raw); this.sync();
    },
    detached() { this.dead = true; this.stopTimer(); clearTimeout(this.closeTimer); clearTimeout(this.subjectTimer); }
  },
  pageLifetimes: {
    hide() { this.visible = false; this.held = false; this.stopTimer(); this.syncSubject(); },
    show() { this.visible = true; this.failed = {}; if (!this.data.open) this.rotateOnResume = true; if (this.store) this.sync(); }
  },
  methods: {
    eligible() { return !this.dead && this.visible && this.data.active && !this.data.editing && !this.data.recording && !this.data.blocked && !this.data.open && !this.data.closing; },
    stopTimer() { clearTimeout(this.rotationTimer); this.rotationTimer = null; },
    schedule() {
      this.stopTimer();
      if (!this.eligible() || this.held || !this.data.item || !this.data.canNext) return;
      this.rotationTimer = setTimeout(() => {
        this.rotationTimer = null;
        if (this.eligible() && !this.held) { this.choose(); this.preview(); this.schedule(); }
      }, recall.INTERVAL);
    },
    touch(active) { this.held = active; this.schedule(); this.syncSubject(); },
    savePreferences(next, required = false) {
      try { wx.setStorageSync(recall.KEY, JSON.stringify(next)); }
      catch (error) { if (required) { this.setData({ error: platform.message(error, '回顾设置未保存，请重试') }); return false; } }
      this.prefs = next; return true;
    },
    available() { return recall.candidates(this.store.get().memories, this.prefs, dates.key(), this.failed); },
    choose() {
      const memories = this.store.get().memories;
      const item = recall.choose(memories, this.prefs, dates.key(), this.data.item && this.data.item.id, this.failed);
      if (item) this.savePreferences(recall.shown(this.prefs, item.id));
      this.setData({ item: recall.describe(item, dates.key()), canNext: this.available().length > 1,
        hiddenCount: this.prefs.hidden.filter(id => !!memories[id]).length, error: '', turn: !this.data.turn });
    },
    preview() {
      const item = this.eligible() && this.data.item;
      const preview = item ? { id: item.id, path: item.path, age: item.age } : null;
      const key = JSON.stringify(preview);
      if (key !== this.previewKey) { this.previewKey = key; this.triggerEvent('preview', { item: preview }); }
    },
    syncSubject() {
      const active = !!(!this.dead && this.visible && (this.eligible() && !this.held || this.data.open && !this.data.closing && this.subjectSettled));
      if (active !== this.data.subjectActive) this.setData({ subjectActive: active });
    },
    subjectReady(e) {
      if (!this.dead && this.data.item && e.detail.path === this.data.item.path) this.setData({ subjectPath: e.detail.path, subjectPreview: e.detail.previewPath });
    },
    subjectFailed(e) {
      if (!this.data.item || e.currentTarget.dataset.path !== this.data.item.path) return;
      if (e.currentTarget.dataset.preview) { this.setData({ subjectPreview: '' }); return; }
      this.imageFailed(e);
    },
    sync() {
      if (this.dead) return;
      const opening = this.data.open && !this.wasOpen;
      if (!this.data.open && this.wasOpen) this.setData({ closing: false });
      if (!this.data.active || this.data.editing || this.data.recording) this.rotateOnResume = true;
      if (opening) {
        this.subjectSettled = false; clearTimeout(this.subjectTimer);
        this.subjectTimer = setTimeout(() => { if (!this.dead && this.data.open) { this.subjectSettled = true; this.syncSubject(); } }, 420);
        this.setData({ closing: false, error: '' });
        const current = this.data.item && this.available().find(m => m.id === this.data.item.id);
        if (!current) this.choose(); else this.setData({ item: recall.describe(current, dates.key()), canNext: this.available().length > 1 });
      }
      this.wasOpen = this.data.open;
      const enabled = this.eligible();
      if (enabled) {
        const current = this.data.item && this.available().find(m => m.id === this.data.item.id);
        if (this.rotateOnResume || !current) this.choose();
        else this.setData({ item: recall.describe(current, dates.key()), canNext: this.available().length > 1 });
        this.rotateOnResume = false;
      }
      this.preview();
      this.syncSubject();
      // Ordinary page refreshes must not keep postponing an idle rotation.
      if (!enabled) this.stopTimer();
      else if (!this.wasEligible || !this.rotationTimer) this.schedule();
      this.wasEligible = enabled;
    },
    next() { if (!this.data.open || this.data.closing) return; this.choose(); },
    imageFailed(e) {
      const id = e.detail && e.detail.id || e.currentTarget && e.currentTarget.dataset.id;
      const path = e.detail && e.detail.path || e.currentTarget && e.currentTarget.dataset.path;
      const memory = this.store.get().memories[id];
      if (!id || !path || !memory || memory.subjectPath !== path) return;
      this.failed[id] = path;
      if (this.data.item && this.data.item.id === id && this.data.item.path === path) {
        this.choose(); this.preview(); this.schedule();
      }
    },
    showDay() {
      if (!this.data.open || !this.data.item || this.data.closing) return;
      const date = this.data.item.date;
      if (!dates.valid(date) || date > dates.key()) { this.setData({ error: '这件记忆的日期无法打开' }); return; }
      this.dismiss({ date });
    },
    hideItem() {
      if (!this.data.item || this.data.closing) return;
      if (!this.savePreferences({ ...this.prefs, hidden: [...new Set([...this.prefs.hidden, this.data.item.id])] }, true)) return;
      this.choose();
    },
    restoreHidden() {
      if (this.data.closing || !this.savePreferences({ ...this.prefs, hidden: [] }, true)) return;
      this.choose();
    },
    close() { this.dismiss(); },
    dismiss(detail = {}) {
      if (!this.data.open || this.data.closing) return;
      this.setData({ closing: true }); this.triggerEvent('closing'); this.stopTimer();
      this.syncSubject();
      this.closeTimer = setTimeout(() => { if (!this.dead && this.data.open) this.triggerEvent('close', detail); }, 220);
    },
    stop() {}
  }
});
