const { createThemePage } = require('./theme-page');
const { createBoardEditor } = require('./board-editor');
const platform = require('./platform');
const config = require('../core/config');

function createThemeBoardPage() {
  const collection = createThemePage({ tab: true, inline: true });
  const editor = createBoardEditor({ inline: true });
  return {
    ...editor, ...collection,
    data: { ...editor.data, ...collection.data, inlineTheme: true, dragging: false, swiping: false, swipePrevious: null, swipeNext: null,
      libraryQuery: '', libraryCategory: '全部', libraryFilters: ['全部', ...config.categories], librarySelected: [], libraryError: '' },
    onShow() { if (!this.data.shareBoardId) this.refresh(); this.syncNavigation(); },
    onHide() { editor.onHide.call(this); },
    onUnload() { collection.onUnload.call(this); editor.onUnload.call(this); },
    syncNavigation() { platform.syncTab(this, 'board', !!(this.data.formOpen || this.data.drawer || this.data.memoryCardId || this.data.shareBoardId || this.data.task || this.data.placing)); },
    refresh() {
      if (this.activeThemeId === undefined) this.activeThemeId = this.store.activeTheme();
      collection.refresh.call(this);
      if (this.data.error) return;
      const id = this.activeThemeId;
      if (id !== this.date) {
        this.cancelGesture(); this.date = id; this.draft = null; this.history = null;
        this.dirty = false; this.checkedDraft = false; this.pendingSelection = ''; this.wantEdit = false;
        this.noteId = ''; this.noteDirty = false;
        // Keep the outgoing board mounted until display publishes the next model.
        // Clearing it here interrupts the same transition used by calendar days.
        this.setData({ editable: false, selected: '', dragging: false, drawer: '', ...(id ? {} : { model: null, count: 0 }), canEdit: false,
          canUndo: false, canRedo: false, saveError: '', saveState: '已保存', noteError: '' });
      }
      if (id) editor.refresh.call(this);
      const index = this.data.themes.findIndex(theme => theme.id === id);
      const neighbour = offset => { const theme = this.data.themes[index + offset]; return theme ? this.store.view(theme.id) : null; };
      this.setData({ swipePrevious: neighbour(-1), swipeNext: neighbour(1) });
      this.store.rememberTheme(id || '');
      this.syncNavigation();
    },
    // Finish pending edits before changing which board the shared editor owns.
    prepareThemeChange() {
      if (this.data.libraryOpen || this.data.pickerPreparing) return false;
      if (this.data.swiping && !this.committingSwipe) return false;
      if (this.data.working || this.data.formOpen || this.data.loading || this.data.error || this.data.recovering || this.mutating || this.memoryOpening || this.photoTask || this.data.placing || this.data.memoryCardId || this.data.shareBoardId) return false;
      this.cancelGesture();
      if (this.dirty && !this.persist() || this.noteDirty && !this.saveNote()) return false;
      this.setData({ drawer: '' }); this.syncNavigation(); return true;
    },
    create() { if (this.prepareThemeChange()) collection.create.call(this); },
    async save() {
      if (this.data.working || !this.data.formOpen) return;
      const creating = this.data.formOpen && !this.data.editingId;
      await collection.save.call(this);
      if (creating && !this.disposed && !this.data.formOpen && this.date) {
        this.setData({ editable: false, selected: '' }); await this.library();
      }
    },
    rename(e) {
      if (!this.prepareThemeChange()) return;
      collection.rename.call(this, e && e.currentTarget && e.currentTarget.dataset.id ? e : { currentTarget: { dataset: { id: this.date } } });
    },
    async removeTheme() {
      if (!this.date || !this.prepareThemeChange()) return;
      await collection.remove.call(this, { currentTarget: { dataset: { id: this.date } } });
    },
    turn(offset) {
      const index = this.data.themes.findIndex(theme => theme.id === this.date), theme = this.data.themes[index + offset];
      if (![-1, 1].includes(offset) || index < 0 || !theme) return;
      if (!this.prepareThemeChange() || this.data.formOpen) return;
      this.activeThemeId = theme.id; this.refresh();
    },
    swipeBoard(e) {
      const before = this.date;
      if (!this.disposed && !this.data.drawer && !this.data.dragging && !this.data.task) {
        this.committingSwipe = true;
        try { this.turn(e.detail.offset); } finally { this.committingSwipe = false; }
      }
      if (this.date === before) { const board = this.selectComponent && this.selectComponent('#board'); if (board && board.cancelSwipe) board.cancelSwipe(); }
    },
    swipeState(e) { this.setData({ swiping: !!e.detail.active }); },
    open(e) {
      const id = e.currentTarget.dataset.id;
      if (!this.data.themes.some(theme => theme.id === id) || !this.prepareThemeChange()) return;
      this.activeThemeId = id; this.refresh(); this.clearSelection();
    },
    openThemePicker() {
      if (!this.prepareThemeChange()) return;
      this.clearSelection(); collection.refresh.call(this);
      this.setData({ drawer: 'themes' }); this.syncNavigation();
    },
    clearSelection() {
      this.cancelGesture();
      if (this.dirty && !this.persist()) return;
      this.setData({ selected: '', editable: false, dragging: false });
    },
    select(e) { editor.select.call(this, e); if (!e.detail.id) this.clearSelection(); },
    gestureState(e) { this.setData({ dragging: !!e.detail.active }); },
    boardAction(e) {
      if (this.data.working || this.data.recovering || this.data.drawer || this.data.formOpen) return;
      const action = e.detail.action;
      if (action === 'add' && this.data.count < config.maxItems) this.library();
      else if (this.data.selected) {
        if (action === 'view') this.memory();
        else if (action === 'undo' && this.data.canUndo) this.undo();
        else if (action === 'front' && this.data.canBringToFront) this.layer({ currentTarget: { dataset: { direction: 'front' } } });
        else if (action === 'remove') this.remove();
      }
    },
    canAdjust() { return !this.data.formOpen && editor.canAdjust.call(this); },
    openSelection() {
      if (!this.date || !this.prepareThemeChange()) return;
      this.setData({ drawer: 'theme' }); this.syncNavigation();
    },
    openAppearance() {
      if (!this.date || !this.prepareThemeChange()) return;
      this.edit(); this.setData({ drawer: 'appearance' }); this.syncNavigation();
    },
    async sourceSheet() {
      if (!this.date || !this.prepareThemeChange()) return;
      await editor.sourceSheet.call(this); this.syncNavigation();
    },
    async library() {
      if (!this.date || !this.prepareThemeChange()) return;
      await editor.library.call(this);
      if (this.data.drawer === 'library') {
        const memories = this.store.get().memories;
        this.setData({ libraryItems: this.data.libraryItems.map(m => ({ ...m, date: memories[m.id].date })),
          librarySelected: [], libraryQuery: '', libraryCategory: '全部', libraryError: '' });
        this.filterLibrary();
      }
      this.syncNavigation();
    },
    filterLibrary() {
      const query = this.data.libraryQuery.trim().toLowerCase(), chosen = new Set(this.data.librarySelected);
      const items = this.data.libraryItems.filter(m => (this.data.libraryCategory === '全部' || m.category === this.data.libraryCategory) &&
        (!query || `${m.text} ${m.date} ${m.category}`.toLowerCase().includes(query))).map(m => ({ ...m, checked: chosen.has(m.id) }));
      this.setData({ visibleLibraryItems: items });
    },
    searchLibrary(e) { this.setData({ libraryQuery: e.detail.value }); this.filterLibrary(); },
    categoryLibrary(e) { this.setData({ libraryCategory: e.currentTarget.dataset.category }); this.filterLibrary(); },
    toggleLibrary(e) {
      if (this.data.drawer !== 'library' || this.data.working) return;
      const id = e.currentTarget.dataset.id, selected = this.data.librarySelected;
      if (!this.data.libraryItems.some(m => m.id === id)) return;
      if (!selected.includes(id) && selected.length >= config.maxItems - this.data.count) {
        this.setData({ libraryError: `这块板还可放入 ${config.maxItems - this.data.count} 件记忆` }); return;
      }
      this.setData({ librarySelected: selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id], libraryError: '' });
      this.filterLibrary();
    },
    addLibrary() {
      if (this.data.drawer !== 'library' || !this.data.librarySelected.length || this.data.working || this.data.recovering) return;
      const ids = this.data.librarySelected;
      this.setData({ working: true, libraryError: '' });
      try {
        this.store.placeMany(ids, this.date);
        this.setData({ drawer: '', librarySelected: [] }); this.photoDone(ids[ids.length - 1]);
        collection.refresh.call(this);
      } catch (error) { this.setData({ libraryError: platform.message(error, '放入失败，请重试') }); }
      finally { this.setData({ working: false }); this.syncNavigation(); }
    },
    openNote(id) { editor.openNote.call(this, id); this.syncNavigation(); },
    closeDrawer() { if (this.data.working) return; editor.closeDrawer.call(this); if (!this.data.drawer && !this.data.selected) this.clearSelection(); this.syncNavigation(); },
    saveNote() { const saved = editor.saveNote.call(this); this.syncNavigation(); return saved; },
    discardNote() { editor.discardNote.call(this); this.syncNavigation(); },
    placeFromLibrary(e) { if (this.data.libraryItems.some(m => m.id === e.currentTarget.dataset.id)) { this.setData({ librarySelected: [e.currentTarget.dataset.id] }); this.addLibrary(); } },
    stickerLanded(e) { editor.stickerLanded.call(this, e); this.syncNavigation(); },
    async remove() { await editor.remove.call(this); if (!this.data.selected) this.closeDrawer(); },
    done() { editor.done.call(this); this.refresh(); },
    shareTheme() {
      if (!this.prepareThemeChange()) return;
      this.exportBoard();
    }
  };
}
module.exports = { createThemeBoardPage };
