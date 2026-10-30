const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const recall = require('../../core/memory-recall');
const platform = require('../../services/platform');
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { active: Boolean, editing: Boolean, recording: Boolean, blocked: Boolean, open: Boolean },
  data: { item: null, scene: 'memory', closing: false, hiddenCount: 0, error: '', dayModel: null, dayMounted: false, canNext: false, turn: false },
  observers: {
    'active, editing, recording, blocked, open': function () { if (this.store) this.sync(); }
  },
  lifetimes: {
    attached() {
      this.store = getStore(); this.visible = true; this.failed = {}; this.rotateOnResume = true;
      let raw; try { raw = wx.getStorageSync(recall.KEY); } catch (_) { /* Optional local preferences. */ }
      this.prefs = recall.preferences(raw); this.sync();
    },
    detached() { this.dead = true; this.stopTimer(); clearTimeout(this.closeTimer); }
  },
  pageLifetimes: {
    hide() { this.visible = false; this.held = false; this.stopTimer(); },
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
    touch(active) { this.held = active; this.schedule(); },
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
    sync() {
      if (this.dead) return;
      const opening = this.data.open && !this.wasOpen;
      if (!this.data.open && this.wasOpen) this.setData({ closing: false, scene: 'memory', dayMounted: false, dayModel: null });
      if (!this.data.active || this.data.editing || this.data.recording) this.rotateOnResume = true;
      if (opening) {
        this.setData({ closing: false, scene: 'memory', dayMounted: false, dayModel: null, error: '' });
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
      // Ordinary page refreshes must not keep postponing an idle rotation.
      if (!enabled) this.stopTimer();
      else if (!this.wasEligible || !this.rotationTimer) this.schedule();
      this.wasEligible = enabled;
    },
    next() { if (!this.data.open || this.data.closing || this.data.scene !== 'memory') return; this.choose(); },
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
      if (!this.data.item || this.data.closing) return;
      try {
        const dayModel = this.store.view(this.data.item.date);
        this.setData({ dayModel, dayMounted: true, scene: 'day', error: '' });
      } catch (error) { this.setData({ error: platform.message(error, '这天的板面暂时无法读取') }); }
    },
    back() { if (!this.data.closing) this.setData({ scene: 'memory', error: '' }); },
    hideItem() {
      if (!this.data.item || this.data.closing || this.data.scene !== 'memory') return;
      if (!this.savePreferences({ ...this.prefs, hidden: [...new Set([...this.prefs.hidden, this.data.item.id])] }, true)) return;
      this.choose();
    },
    restoreHidden() {
      if (this.data.closing || !this.savePreferences({ ...this.prefs, hidden: [] }, true)) return;
      this.choose();
    },
    close() {
      if (!this.data.open || this.data.closing) return;
      this.setData({ closing: true }); this.triggerEvent('closing'); this.stopTimer();
      this.closeTimer = setTimeout(() => { if (!this.dead) this.triggerEvent('close'); }, 220);
    },
    stop() {}
  }
});
