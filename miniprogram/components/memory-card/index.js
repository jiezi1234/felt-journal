const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const config = require('../../core/config');
const platform = require('../../services/platform');
const { newId } = require('../../services/photo-task');
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { memoryId: String },
  data: { memory: null, dateLabel: '', flipped: false, editing: false, text: '', error: '', hint: '', missing: false, maxText: config.maxText,
    themeOpen: false, themeCreating: false, themeWorking: false, themeTitle: '', themeError: '', themes: [], visibleThemes: [], themePage: 1, themePageCount: 1, maxThemeTitle: config.maxBoardTitle },
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
        if (this.data.themeOpen) this.refreshThemes();
      } catch (error) { this.setData({ error: platform.message(error, '记忆读取失败'), memory: null }); }
    },
    flip() { if (!this.data.editing && !this.data.themeOpen && this.data.memory) this.setData({ flipped: !this.data.flipped }); },
    edit() { if (this.data.memory && !this.data.themeOpen) this.setData({ flipped: true, editing: true, error: '', hint: '' }); },
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
    openThemes() {
      if (!this.data.memory || !this.data.flipped || this.data.editing || this.data.themeWorking) return;
      this.setData({ themeOpen: true, themeCreating: false, themePage: 1, themeError: '' }); this.refreshThemes();
    },
    refreshThemes() {
      try {
        const state = this.store.load();
        if (!state.memories[this.data.memoryId]) throw new Error('这条记忆已被删除');
        const themes = Object.values(state.boards).filter(board => board.type === 'theme')
          .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
          .map(board => ({ id: board.id, title: board.title, placed: board.placements.some(p => p.memoryId === this.data.memoryId), full: board.placements.length >= config.maxItems }));
        const themePageCount = Math.max(1, Math.ceil(themes.length / 2)), themePage = Math.min(this.data.themePage, themePageCount);
        this.setData({ themes, themePage, themePageCount, visibleThemes: themes.slice((themePage - 1) * 2, themePage * 2) });
      } catch (error) { this.setData({ themes: [], visibleThemes: [], themeError: platform.message(error, '主题板读取失败，请重试') }); }
    },
    closeThemes() { if (!this.data.themeWorking) this.setData({ themeOpen: false, themeCreating: false, themeError: '' }); },
    turnThemes(e) {
      if (this.data.themeWorking) return;
      const offset = Number(e.currentTarget.dataset.offset); if (offset !== -1 && offset !== 1) return;
      this.setData({ themePage: Math.max(1, Math.min(this.data.themePageCount, this.data.themePage + offset)), themeError: '' }); this.refreshThemes();
    },
    placeTheme(e) {
      if (!this.data.themeOpen || this.data.themeCreating || this.data.themeWorking) return;
      this.setData({ themeWorking: true, themeError: '' });
      try {
        const id = e.currentTarget.dataset.id, board = this.store.load().boards[id];
        if (!board || board.type !== 'theme') throw new Error('主题板已被删除或不存在');
        this.store.place(this.data.memoryId, id); this.themePlaced();
      } catch (error) { this.refreshThemes(); this.setData({ themeError: platform.message(error, '未能放入主题板，请重试') }); }
      finally { this.setData({ themeWorking: false }); }
    },
    createTheme() {
      if (!this.data.themeOpen || this.data.themeWorking) return;
      this.themeCreateId = newId(); this.setData({ themeCreating: true, themeTitle: '', themeError: '' });
    },
    themeInput(e) { this.setData({ themeTitle: e.detail.value, themeError: '' }); },
    cancelThemeCreate() { if (!this.data.themeWorking) { this.setData({ themeCreating: false, themeError: '' }); this.refreshThemes(); } },
    saveTheme() {
      if (!this.data.themeOpen || !this.data.themeCreating || this.data.themeWorking) return;
      this.setData({ themeWorking: true, themeError: '' });
      try { this.store.load(); this.store.createTheme(this.themeCreateId, this.data.themeTitle, this.data.memoryId); this.themePlaced(); }
      catch (error) { this.setData({ themeError: platform.message(error, '主题板未保存，请重试') }); }
      finally { this.setData({ themeWorking: false }); }
    },
    themePlaced() {
      this.setData({ themeOpen: false, themeCreating: false, themeError: '' });
      this.triggerEvent('change', { id: this.data.memoryId }); platform.toast('已放入主题板');
    },
    close() { if (this.data.memory && this.dirty && !this.save()) return; this.triggerEvent('close'); },
    imageError() { this.setData({ missing: true }); }, stop() {}
  }
});
