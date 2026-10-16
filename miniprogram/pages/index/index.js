const { createBoardEditor } = require('../../services/board-editor');
const dates = require('../../core/date');
const platform = require('../../services/platform');
const motion = require('../../core/sticker-motion');
const editor = createBoardEditor();
Page({
  ...editor,
  data: { ...editor.data, editorOpen: false, editorDate: '' },
  onLoad() { editor.onLoad.call(this, { date: dates.key() }); },
  onShow() {
    platform.syncTab(this, 'today', this.data.editorOpen || !!this.data.placing);
    if (!this.data.editorOpen && !this.data.placing) this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (!this.data.editorOpen && !this.data.placing && dates.key() !== this.date) this.refresh(); }, 30000);
  },
  onHide() { clearInterval(this.timer); editor.onHide.call(this); if (this.data.drawer === 'selection') this.setData({ drawer: '' }); },
  onUnload() { clearInterval(this.timer); editor.onUnload.call(this); },
  refresh() {
    if (this.disposed) return;
    try {
      this.store.load();
      const date = this.data.editorOpen || this.data.placing ? this.date : dates.key();
      if (date !== this.date) {
        if (this.dirty && !this.persist()) return;
        this.date = date; this.history = null; this.checkedDraft = false;
        this.setData({ editable: false, selected: '' });
      }
      editor.refresh.call(this);
    } catch (e) { this.setData({ loading: false, error: platform.message(e, '本地记录读取失败，请重试') }); }
  },
  cancelGesture() { const board = this.selectComponent && this.selectComponent('#today-board'); if (board) board.touchCancel(); },
  canAdjust() { return !this.data.editorOpen && editor.canAdjust.call(this); },
  openBoard() {
    if (this.data.editorOpen || this.data.placing || this.data.loading || this.data.error) return;
    this.edit();
  },
  primary() {
    if (this.data.editorOpen || this.data.placing || this.data.loading || this.data.error || this.data.recovering) return;
    this.cancelGesture(); if (this.dirty && !this.persist()) return;
    this.refresh(); if (this.data.error) return;
    this.setData({ editorDate: this.date, editorOpen: true, drawer: '' }); platform.syncTab(this, 'today', true);
  },
  sourceSheet() { this.primary(); },
  editorChanged() { /* The processing card owns the pending result until placement. */ },
  closeEditor() {
    if (this.data.placing) return;
    this.setData({ editorOpen: false }); platform.syncTab(this, 'today'); this.refresh();
  },
  startSticker(e) {
    if (this.data.placing || !this.data.editorOpen) return;
    const id = e.detail.id, memory = this.store.get().memories[id];
    const source = memory && motion.imageRect(e.detail.rect, memory);
    if (!source) { this.closeEditor(); this.edit(); return; }
    const token = this.placementToken = (this.placementToken || 0) + 1;
    this.setData({ placing: { id, path: memory.subjectPath, source, token }, selected: id, editable: true });
    this.refresh();
    this.placementTimer = setTimeout(() => this.stickerLanded({ detail: { token } }), 6000);
  },
  stickerLifted(e) {
    if (this.disposed || !this.data.placing || this.data.placing.token !== e.detail.token) return;
    this.setData({ editorOpen: false });
  },
  stickerLanded(e) {
    const placing = this.data.placing;
    if (!placing || this.disposed || e && e.detail && e.detail.token !== placing.token) return;
    editor.stickerLanded.call(this, e);
    this.setData({ editorOpen: false }); platform.syncTab(this, 'today');
  },
  openMemory(e) { if (!this.data.editorOpen && !this.data.placing) this.memory(e); },
  exportToday() { if (!this.data.editorOpen && !this.data.placing) this.exportBoard(); },
  openSelection() { if (this.canAdjust()) { this.cancelGesture(); this.setData({ drawer: 'selection' }); } },
  async remove() { await editor.remove.call(this); if (!this.disposed && !this.data.selected) this.setData({ drawer: '' }); }
});
