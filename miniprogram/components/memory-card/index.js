const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const config = require('../../core/config');
const platform = require('../../services/platform');
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { memoryId: String },
  data: { memory: null, dateLabel: '', flipped: false, editing: false, text: '', error: '', hint: '', missing: false, maxText: config.maxText },
  lifetimes: {
    attached() { this.store = getStore(); this.refresh(); },
    detached() { if (this.dirty) this.keepDraft(); this.dead = true; platform.unloadGuard(false); }
  },
  pageLifetimes: { show() { if (this.store) this.refresh(); }, hide() { if (this.dirty) this.keepDraft(); } },
  methods: {
    refresh() {
      try {
        const memory = this.store.load().memories[this.data.memoryId];
        if (!memory) throw new Error('这条记忆已被删除');
        this.setData({ memory, dateLabel: dates.label(memory.date), error: '' });
        if (!this.dirty) this.setData({ text: memory.text });
        if (!this.checkedDraft) {
          this.checkedDraft = true; const draft = this.store.getMemoryDraft(memory.id);
          if (draft) { this.dirty = true; this.setData({ text: draft.text, flipped: true, editing: true, hint: '已恢复未保存的文字' }); platform.unloadGuard(true); }
        }
      } catch (error) { this.setData({ error: platform.message(error, '记忆读取失败'), memory: null }); }
    },
    flip() { if (!this.data.editing && this.data.memory) this.setData({ flipped: !this.data.flipped }); },
    edit() { if (this.data.memory) this.setData({ flipped: true, editing: true, error: '', hint: '' }); },
    input(e) { this.dirty = true; this.setData({ text: e.detail.value, error: '', hint: '' }); this.keepDraft(); },
    keepDraft() {
      const memory = this.store.get().memories[this.data.memoryId];
      if (memory) this.store.keepMemoryDraft(memory.id, { text: this.data.text, category: Math.max(0, config.categories.indexOf(memory.category)) });
      platform.unloadGuard(true);
    },
    save() {
      try {
        const memory = this.store.get().memories[this.data.memoryId];
        if (!memory) throw new Error('这条记忆已被删除');
        if (this.dirty) this.store.edit(memory.id, this.data.text, memory.category);
        this.store.clearMemoryDraft(memory.id); this.dirty = false;
        this.setData({ memory: this.store.get().memories[memory.id], editing: false, error: '', hint: '' });
        platform.unloadGuard(false); this.triggerEvent('change', { id: memory.id }); return true;
      } catch (error) { this.setData({ error: platform.message(error, '文字未保存，请重试') }); this.keepDraft(); return false; }
    },
    cancelEdit() {
      const memory = this.store.get().memories[this.data.memoryId];
      this.store.clearMemoryDraft(this.data.memoryId); this.dirty = false;
      this.setData({ text: memory ? memory.text : '', editing: false, error: '', hint: '' }); platform.unloadGuard(false);
    },
    close() { if (this.data.memory && this.dirty && !this.save()) return; this.triggerEvent('close'); },
    details() { if (this.dirty && !this.save()) return; this.triggerEvent('details', { id: this.data.memoryId }); },
    imageError() { this.setData({ missing: true }); }, stop() {}
  }
});
