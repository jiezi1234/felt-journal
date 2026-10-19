const { createThemePage } = require('./theme-page');
const { createBoardEditor } = require('./board-editor');
const platform = require('./platform');

function createThemeBoardPage() {
  const collection = createThemePage({ tab: true, inline: true });
  const editor = createBoardEditor({ inline: true });
  return {
    ...editor, ...collection,
    data: { ...editor.data, ...collection.data, inlineTheme: true },
    onShow() { this.refresh(); this.syncNavigation(); },
    onHide() { editor.onHide.call(this); },
    onUnload() { collection.onUnload.call(this); editor.onUnload.call(this); },
    syncNavigation() { platform.syncTab(this, 'board', !!(this.data.formOpen || this.data.drawer || this.data.task || this.data.placing)); },
    refresh() {
      collection.refresh.call(this);
      if (this.data.error) return;
      const id = this.activeThemeId;
      if (id !== this.date) {
        this.cancelGesture(); this.date = id; this.draft = null; this.history = null;
        this.dirty = false; this.checkedDraft = false; this.pendingSelection = ''; this.wantEdit = false;
        this.noteId = ''; this.noteDirty = false;
        this.setData({ editable: false, selected: '', drawer: '', model: null, count: 0, canEdit: false,
          canUndo: false, canRedo: false, saveError: '', saveState: '已保存', noteError: '' });
      }
      if (id) editor.refresh.call(this);
      this.syncNavigation();
    },
    // Finish pending edits before changing which board the shared editor owns.
    prepareThemeChange() {
      if (this.data.working || this.data.recovering || this.mutating || this.photoTask || this.data.placing) return false;
      this.cancelGesture();
      if (this.dirty && !this.persist() || this.noteDirty && !this.saveNote()) return false;
      this.setData({ drawer: '' }); this.syncNavigation(); return true;
    },
    create() { if (this.prepareThemeChange()) collection.create.call(this); },
    rename(e) {
      if (!this.prepareThemeChange()) return;
      collection.rename.call(this, e && e.currentTarget && e.currentTarget.dataset.id ? e : { currentTarget: { dataset: { id: this.date } } });
    },
    async removeTheme() {
      if (!this.date || !this.prepareThemeChange()) return;
      await collection.remove.call(this, { currentTarget: { dataset: { id: this.date } } });
    },
    turn(offset) {
      if (!this.prepareThemeChange() || this.data.formOpen) return;
      const page = Math.max(1, Math.min(this.data.pageCount, this.data.page + offset));
      const theme = this.data.themes[page - 1];
      if (theme) { this.activeThemeId = theme.id; this.setData({ page }); this.refresh(); }
    },
    open(e) {
      const id = e.currentTarget.dataset.id;
      if (!this.data.themes.some(theme => theme.id === id) || !this.prepareThemeChange()) return;
      this.activeThemeId = id; this.refresh(); this.edit();
    },
    canAdjust() { return !this.data.formOpen && editor.canAdjust.call(this); },
    openSelection() {
      if (!this.date || !this.prepareThemeChange()) return;
      this.setData({ drawer: 'theme' }); this.syncNavigation();
    },
    async sourceSheet() {
      if (!this.date || !this.prepareThemeChange()) return;
      this.edit(); await editor.sourceSheet.call(this); this.syncNavigation();
    },
    async library() {
      if (!this.date || !this.prepareThemeChange()) return;
      this.edit(); await editor.library.call(this); this.syncNavigation();
    },
    openNote(id) { editor.openNote.call(this, id); this.syncNavigation(); },
    closeDrawer() { editor.closeDrawer.call(this); this.syncNavigation(); },
    saveNote() { const saved = editor.saveNote.call(this); this.syncNavigation(); return saved; },
    discardNote() { editor.discardNote.call(this); this.syncNavigation(); },
    placeFromLibrary(e) { editor.placeFromLibrary.call(this, e); this.syncNavigation(); },
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
