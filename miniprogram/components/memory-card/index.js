const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const config = require('../../core/config');
const platform = require('../../services/platform');
const { newId } = require('../../services/photo-task');
const modal = require('../../services/modal-presentation');
const pickup = require('../../services/memory-pickup');
const cardTurn = require('../../services/card-turn');
const CARD_STYLES = ['cotton', 'polaroid', 'ticket'];
function cardDetails(memory) {
  const [year, month, day] = memory.date.split('-');
  const firstLine = (memory.text || '').split(/\r?\n/).map(line => line.trim()).find(Boolean);
  return { dateLabel: dates.label(memory.date), cardDate: `${year}.${month}.${day}`, cardYear: year,
    cardMonth: `${Number(month)} 月`, cardDay: day, frontCaption: firstLine || '把平凡的一刻，轻轻收好' };
}
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { memoryId: String, source:Object },
  data: { memory: null, dateLabel: '', cardStyle: 'cotton', cardDate: '', cardYear: '', cardMonth: '', cardDay: '', frontCaption: '', flipped: false, flipBusy: false, turning: false, noteFocus: false, editing: false, text: '', error: '', hint: '', missing: false, maxText: config.maxText,
    themeOpen: false, themeCreating: false, themeWorking: false, themeTitle: '', themeError: '', themes: [], visibleThemes: [], themePage: 1, themePageCount: 1, maxThemeTitle: config.maxBoardTitle },
  lifetimes: {
    attached() { pickup.mount(this); modal.mount(this); this.store = getStore(); this.refresh(); },
    ready() { pickup.ready(this); },
    detached() { cardTurn.cancel(this); pickup.dispose(this); modal.dispose(this); if (this.dirty) this.keepDraft(); this.dead = true; platform.unloadGuard(false); }
  },
  pageLifetimes: { show() { if (this.store) this.refresh(); }, hide() { pickup.interrupted(this); if (this.dirty) this.keepDraft(); }, resize() { pickup.interrupted(this); } },
  methods: {
    pickupPhotoLoaded(e) { pickup.imageLoaded(this, e, false); },
    pickupFlightLoaded(e) { pickup.imageLoaded(this, e, true); },
    pickupLifted(ok) { pickup.begin(this, ok); },
    pickupReturn(rect) { pickup.returnTo(this, rect); },
    pickupFailed() { pickup.fallback(this); },
    refresh() {
      // Choose once per opening. Refreshes, drafts and saves keep both faces in
      // the same material; presentation never writes a style into the journal.
      if (!this.cardStyleChosen) {
        this.cardStyleChosen = true;
        this.setData({ cardStyle: CARD_STYLES[Math.floor(Math.random() * CARD_STYLES.length)] });
      }
      try {
        const memory = this.store.load().memories[this.data.memoryId];
        if (!memory) throw new Error('这条记忆已被删除');
        this.setData({ memory, ...cardDetails(memory), error: '' });
        if (!this.dirty) this.setData({ text: memory.text });
        if (!this.checkedDraft) {
          this.checkedDraft = true; const draft = this.store.getMemoryDraft(memory.id);
          if (draft) { this.dirty = true; this.setData({ text: draft.text, flipped: true, editing: true, hint: '已恢复未保存的文字' }); platform.unloadGuard(true); }
        }
        if (this.data.themeOpen) this.refreshThemes();
      } catch (error) { this.setData({ error: platform.message(error, '记忆读取失败'), memory: null }); }
    },
    turnTo(back, done) { cardTurn.turn(this, back, done); },
    flip() { if (!this.data.pickupBusy && !this.data.flipBusy && !this.data.editing && !this.data.themeOpen && this.data.memory) this.turnTo(!this.data.flipped); },
    edit() {
      if (this.data.pickupBusy || this.data.flipBusy || !this.data.memory || this.data.themeOpen) return;
      this.setData({ flipped:true, editing:true, noteFocus:true, error:'', hint:'' });
    },
    noteFocused() { if (!this.data.noteFocus) this.setData({ noteFocus:true }); },
    noteBlurred() { if (this.data.noteFocus) this.setData({ noteFocus:false }); },
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
        const saved = this.store.get().memories[memory.id];
        this.setData({ memory: saved, ...cardDetails(saved), editing: false, noteFocus: false, error: '', hint: '' });
        platform.unloadGuard(false); this.triggerEvent('change', { id: memory.id }); return true;
      } catch (error) { this.setData({ error: platform.message(error, '文字未保存，请重试') }); this.keepDraft(); return false; }
    },
    cancelEdit() {
      const memory = this.store.get().memories[this.data.memoryId];
      this.store.clearMemoryDraft(this.data.memoryId); this.dirty = false;
      this.setData({ text: memory ? memory.text : '', editing: false, noteFocus: false, error: '', hint: '' }); platform.unloadGuard(false);
    },
    openThemes() {
      if (this.data.pickupBusy || this.data.flipBusy || !this.data.memory || !this.data.flipped || this.data.editing || this.data.themeWorking) return;
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
    close() {
      if (this.data.themeOpen) { this.closeThemes(); return; }
      if (this.data.memory && this.dirty && !this.save()) return;
      pickup.close(this, () => this.triggerEvent('close'));
    },
    imageError() { this.setData({ missing: true }); pickup.fallback(this); }, stop() {}
  }
});
