const { getStore, isThemeId, boardLabel, membership } = require('../core/store');
const { createBoardHistory } = require('../core/board-history');
const layers = require('../core/layers');
const dates = require('../core/date');
const config = require('../core/config');
const geometry = require('../core/geometry');
const platform = require('./platform');
const photo = require('./page-photo');
const stickerMotion = require('../core/sticker-motion');
const feedback = require('./board-feedback');
const boardMemory = require('./board-memory');
function createBoardEditor(options = {}) { return {
  // Placement feedback never changes the saved model or creates another memory.
  data: { showBoardGuide: false, layoutSaved: false, shareBoardId: '', memoryCardId: '', memoryCardSource: null, photoNoteOpen: false, photoNoteText: '', photoNoteError: '', embedded: !!options.embedded, sourceStage: false, drawer: '', libraryItems: [], visibleLibraryItems: [], libraryPage: 1, libraryPageCount: 1, noteText: '', noteCategory: 0, noteError: '', noteHint: '', categories: config.categories, maxText: config.maxText, loading: true, error: '', date: '', dateLabel: '', isTheme: false, editable: false, canEdit: false, selected: '', model: null, count: 0, saveState: '已保存', saveError: '', task: null, placing: null, colors: config.colors, textures: config.textures, appearanceLabel: '', canUndo: false, canRedo: false, canBringToFront: false, canSendToBack: false, recovering: false, openingLibrary: false },
  onLoad(query) {
    this.store = getStore(); this.date = query.board || query.date || dates.key(); this.wantEdit = query.mode === 'edit'; this.wantAdd = query.add === '1';
  },
  onShow() { if (!this.data.shareBoardId) this.refresh(); },
  onResize() { this.stickerLanded(); },
  onReady() { if (this.wantAdd && !this.data.error) { this.wantAdd = false; this.sourceSheet(); } },
  onHide() { boardMemory.cancel(this); this.stickerLanded(); this.cancelGesture(); if (this.dirty) this.persist(); if (this.noteDirty) this.keepNoteDraft(); feedback.reset(this); },
  onUnload() { boardMemory.cancel(this); clearTimeout(this.placementTimer); if (this.dirty) { this.store.keepDraft(this.draft); this.persist(); } if (this.noteDirty) this.keepNoteDraft(); feedback.reset(this); photo.dispose(this); platform.unloadGuard(false); },
  refresh() {
    try {
      photo.refreshResult(this);
      if (!isThemeId(this.date) && (!dates.valid(this.date) || this.date > dates.key())) throw new Error('不能进入未来或无效日期');
      const saved = this.store.board(this.date); if (!this.dirty) this.draft = saved;
      if (!this.history) this.history = createBoardHistory(this.draft, config.historyLimit);
      else this.history.sync(this.draft);
      const canEdit = this.store.canEdit(this.date);
      this.setData({ loading: false, error: '', date: this.date, dateLabel: boardLabel(this.draft), isTheme: this.draft.type === 'theme', canEdit, editable: canEdit && !!(this.data.editable || this.wantEdit), selected: this.pendingSelection || this.data.selected }); this.wantEdit = false; this.pendingSelection = '';
      this.display();
      if (!this.checkedDraft) { this.checkedDraft = true; this.recoverDraft(); }
    } catch (e) { this.setData({ loading: false, error: platform.message(e, '板面读取失败，请重试') }); }
  },
  display() {
    const state = this.store.get(), memories = state.memories;
    const items = layers.ordered(this.draft.placements).map(p => Object.assign({}, p, { memory: memories[p.memoryId] })).filter(p => p.memory);
    const selected = items.some(p => p.memoryId === this.data.selected) ? this.data.selected : '';
    const color = config.colors.find(c => c.value === this.draft.color), texture = config.textures.find(t => t.value === this.draft.texture);
    this.setData(Object.assign({ model: Object.assign({}, this.draft, { items }), count: items.length, selected,
      showBoardGuide: !!items.length && this.data.canEdit && !state.boardGuideSeen && !this.guideLearned,
      layoutSaved: !!this.data.layoutSaved && this.feedbackBoard === this.date,
      appearanceLabel: `${color ? color.name : ''} · ${texture ? texture.name : ''}` }, this.history.status(), layers.availability(this.draft, selected)));
  },
  async recoverDraft() {
    const draft = this.store.getDraft(this.date); if (!draft || !this.data.canEdit) return;
    if (JSON.stringify(draft) === JSON.stringify(this.draft)) { this.store.clearDraft(this.date); return; }
    const ids = b => b.placements.map(p => p.memoryId).sort().join(',');
    if (!Array.isArray(draft.placements) || ids(draft) !== ids(this.draft) || membership(draft) !== membership(this.draft)) { this.store.clearDraft(this.date); return; }
    this.setData({ recovering: true });
    try {
      const r = await platform.call('showModal', { title: '发现未保存的布局', content: '上次保存没有完成。是否恢复这份布局并重新保存？', confirmText: '恢复', cancelText: '放弃', confirmColor: '#4D7D5B' });
      if (this.disposed) return;
      if (r.confirm) { if (this.data.isTheme) draft.title = this.draft.title; this.draft = draft; this.setData({ editable: true }); this.changed(); }
      else this.store.clearDraft(this.date);
    } catch (e) { if (!this.disposed) platform.toast(platform.message(e, '布局恢复未完成，请重新打开板面')); }
    finally { if (!this.disposed) this.setData({ recovering: false }); }
  },
  cancelGesture() { const board = this.selectComponent && this.selectComponent('#board'); if (board) board.touchCancel(); },
  canAdjust() { return this.data.editable && !this.memoryOpening && !this.data.shareBoardId && !this.data.memoryCardId && !this.photoTask && !this.data.placing && !this.data.recovering && !this.mutating && !this.data.openingLibrary; },
  changed(record = true) {
    if (record && !this.history.record(this.draft)) { this.display(); return !this.dirty || this.persist(); }
    this.dirty = true; this.store.keepDraft(this.draft); platform.unloadGuard(true); this.display(); return this.persist();
  },
  undo() { this.restoreLayout('undo'); },
  redo() { this.restoreLayout('redo'); },
  restoreLayout(action) {
    if (!this.canAdjust()) return;
    this.cancelGesture();
    const next = this.history[action](); if (!next) return;
    this.draft = next; this.changed(false);
  },
  layer(e) {
    if (!this.canAdjust() || !this.data.selected) return;
    this.cancelGesture();
    this.draft = layers.move(this.draft, this.data.selected, e.currentTarget.dataset.direction); this.changed();
  },
  persist() {
    if (!this.draft) return false;
    const changed = !!this.dirty;
    this.setData({ saveState: '保存中…' });
    try {
      this.store.saveBoard(this.draft, { boardGuideSeen: this.guideLearned }); this.dirty = false; platform.unloadGuard(!!this.photoTask || !!this.noteDirty);
      this.setData({ saveState: '已保存', saveError: '' }); if (changed) feedback.saved(this); return true;
    } catch (e) {
      this.dirty = true; const durable = this.store.keepDraft(this.draft); feedback.reset(this);
      this.setData({ saveState: '保存失败，请重试', saveError: platform.message(e, '保存未完成') + (durable ? '' : '。请保持当前页面，稍后重试') }); return false;
    }
  },
  retrySave() { this.persist(); },
  edit() { if (this.data.canEdit && !this.data.editable && !this.data.shareBoardId && !this.photoTask && !this.data.recovering) { this.history.reset(this.draft); this.setData({ editable: true }); this.display(); } },
  editItem(e) {
    const id = e.detail.id;
    if (!this.data.canEdit || !this.store.canEdit(this.date) || this.data.loading || this.data.error || this.data.drawer || this.data.formOpen || this.data.editorOpen ||
      this.data.shareBoardId || this.data.memoryCardId || this.data.task || this.photoTask || this.data.placing || this.data.recovering || this.data.openingLibrary || this.data.working || this.mutating ||
      this.draft.id !== this.date || !this.draft.placements.some(p => p.memoryId === id) || !this.store.get().memories[id]) return;
    this.edit(); this.select(e); feedback.learn(this);
  },
  done() {
    if (!this.canAdjust() || this.noteDirty && !this.saveNote()) return;
    this.cancelGesture();
    if (this.data.embedded) { if (!this.dirty || this.persist()) this.closeCard(); return; }
    if (this.persist()) { this.history.reset(this.draft); this.setData({ editable: false, selected: '', drawer: '' }); this.display(); }
  },
  select(e) { if (this.canAdjust()) { this.setData(Object.assign({ selected: e.detail.id }, layers.availability(this.draft, e.detail.id))); } },
  placementChanged(e) {
    if (!this.canAdjust()) return;
    const clean = Object.assign({}, e.detail.placement); delete clean.memory;
    this.draft.placements = this.draft.placements.map(p => p.id === clean.id ? clean : p); this.changed();
  },
  transform(e) {
    if (!this.canAdjust() || !this.data.selected) return;
    this.cancelGesture();
    this.draft.placements = this.draft.placements.map(p => p.memoryId === this.data.selected ? geometry.transform(p, e.detail.op) : p); this.changed();
  },
  color(e) {
    const value = e.currentTarget.dataset.value;
    if (!this.canAdjust() || !config.colors.some(c => c.value === value)) return;
    this.cancelGesture(); this.draft.color = value; this.changed();
  },
  texture(e) {
    const value = e.currentTarget.dataset.value;
    if (!this.canAdjust() || !config.textures.some(t => t.value === value)) return;
    this.cancelGesture(); this.draft.texture = value; this.changed();
  },
  memory(e) {
    const id = e && e.detail && e.detail.id || this.data.selected; if (!id || this.memoryOpening || this.data.memoryCardId || this.data.shareBoardId || this.photoTask || this.data.recovering) return;
    this.cancelGesture();
    if (this.dirty && !this.persist()) { platform.toast('请先重试保存当前布局'); return; }
    if (this.data.embedded) { this.openNote(id); return; }
    return boardMemory.open(this, id);
  },
  liftMemoryPickup(e) { return boardMemory.lift(this, e); },
  returnMemoryPickup(e) { return boardMemory.returnSource(this, e); },
  restoreMemoryPickup() { return boardMemory.restore(this); },
  closeMemoryCard() { return boardMemory.close(this); },
  memoryCardChanged() { this.refresh(); },
  async sourceSheet() {
    if (!this.data.canEdit || this.data.shareBoardId || this.photoTask || this.data.placing || this.data.error || this.data.recovering) return;
    if (this.data.embedded) this.setData({ sourceStage: true, drawer: '' });
    else this.setData({ drawer: 'source' });
  },
  camera() { return this.add('camera'); }, album() { return this.add('album'); },
  add(source) {
    if (this.data.shareBoardId || this.photoTask || this.data.placing || this.data.recovering || this.mutating || this.data.error || this.data.loading) return;
    if (!this.store.canEdit(this.date)) { platform.toast('日期已变化，请关闭卡片后重新记录'); return; }
    this.cancelGesture();
    if (this.draft.placements.length >= config.maxItems) { platform.toast(`每块板最多 ${config.maxItems} 件记忆`); return; }
    if (this.dirty && !this.persist()) { platform.toast('请先保存当前布局'); return; }
    this.setData({ drawer: '' }); return photo.begin(this, source, { date: isThemeId(this.date) ? dates.key() : this.date, targetBoardId: this.date });
  },
  photoDone(id) { this.draft = this.store.board(this.date); this.history.reset(this.draft); this.setData({ selected: id, editable: true, canEdit: true, sourceStage: false }); this.display(); this.notifyChange(); },
  retryPhoto() { return photo.retry(this); }, originalPhoto() { return photo.original(this); },
  adjustPhoto() { return photo.adjustResult(this); },
  openPhotoNote() { photo.openNote(this); }, photoNoteInput(e) { photo.inputNote(this, e); },
  cancelPhoto(e) {
    if (this.data.placing || this.data.photoAdjusting) return;
    if (!photo.saveNote(this)) return;
    const task = this.photoTask, id = this.data.selected;
    const memory = task && task.committed && this.store.get().memories[id];
    const source = memory && stickerMotion.imageRect(e && e.detail && e.detail.rect, memory);
    if (!source) return photo.cancel(this);
    const token = (this.placementToken || 0) + 1; this.placementToken = token;
    this.setData({ placing: { id, path: memory.subjectPath, source, token } });
    // A missing canvas/image must not leave an invisible, uneditable memory.
    this.placementTimer = setTimeout(() => this.stickerLanded({ detail: { token } }), 6000);
  },
  stickerLifted(e) {
    if (!this.data.placing || this.disposed || this.data.placing.token !== e.detail.token) return;
    photo.finish(this, false);
  },
  stickerTarget(e) {
    const placing = this.data.placing;
    if (!placing || this.disposed || placing.target || placing.id !== e.detail.id || !stickerMotion.validRect(e.detail.target)) return;
    this.setData({ placing: Object.assign({}, placing, { target: e.detail.target }) });
  },
  stickerLanded(e) {
    const placing = this.data.placing;
    if (!placing || this.disposed || e && e.detail && e.detail.token !== placing.token) return;
    clearTimeout(this.placementTimer); photo.finish(this, false); this.setData({ placing: null });
    if (e) platform.localNotice(this.store).catch(() => {});
  },
  async library() {
    if (!this.data.canEdit || this.data.shareBoardId || this.data.error || this.photoTask || this.data.placing || this.data.recovering || this.data.openingLibrary || this.mutating) return;
    this.cancelGesture(); if (this.dirty && !this.persist()) return;
    if (this.draft.placements.length >= config.maxItems) { platform.toast(`每块板最多 ${config.maxItems} 件记忆`); return; }
    if (this.data.embedded || options.inline) {
      const used = new Set(this.draft.placements.map(p => p.memoryId));
      const items = Object.values(this.store.get().memories).filter(m => (this.data.isTheme || m.date === this.date) && !used.has(m.id)).sort((a,b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).map(m => ({ id: m.id, path: m.subjectPath, text: m.text, category: m.category }));
      this.setData({ drawer: 'library', libraryItems: items, visibleLibraryItems: items.slice(0, 3), libraryPage: 1, libraryPageCount: Math.max(1, Math.ceil(items.length / 3)) }); return;
    }
    this.setData({ openingLibrary: true });
    try {
      await platform.call('navigateTo', { url: `/pages/memories/index?target=${encodeURIComponent(this.date)}`, events: {
        placed: ({ id, boardId }) => { if (!this.disposed && boardId === this.date) { this.pendingSelection = id; this.wantEdit = true; } }
      } });
    } catch (e) { if (!this.disposed) platform.toast(platform.message(e, '记忆库暂时无法打开')); }
    finally { if (!this.disposed) this.setData({ openingLibrary: false }); }
  },
  async remove() {
    if (!this.canAdjust() || !this.data.selected) return;
    this.cancelGesture();
    if (this.dirty && !this.persist()) return;
    const selected = this.data.selected, boardId = this.date; this.mutating = true;
    try {
      if (!await platform.confirmRemovePlacement() || this.disposed || this.date !== boardId) return;
      this.store.unplace(selected, boardId); this.draft = this.store.board(boardId); this.history.reset(this.draft); this.setData({ selected: '' }); this.refresh();
    } catch (e) { if (!this.disposed) platform.toast(platform.message(e, '移除失败，请重试')); }
    finally { this.mutating = false; }
  },
  exportBoard() {
    if (this.disposed || !this.data.count || this.data.loading || this.data.error || this.data.shareBoardId || this.data.memoryCardId ||
      this.data.formOpen || this.data.editorOpen || this.data.drawer || this.data.task || this.photoTask || this.data.placing ||
      this.data.recovering || this.data.openingLibrary || this.data.working || this.mutating) return;
    this.cancelGesture();
    if (this.dirty && !this.persist()) return;
    const board = this.selectComponent && (this.selectComponent('#today-board') || this.selectComponent('#board'));
    const shareViewport = board && board.exportViewport ? board.exportViewport() : null;
    if (board && board.exportViewport && !shareViewport) { platform.toast('板面准备中，请稍后重试'); return; }
    this.setData({ shareBoardId: this.date, shareViewport }); if (this.syncNavigation) this.syncNavigation();
  },
  closeShareCard() { this.setData({ shareBoardId: '' }); if (this.syncNavigation) this.syncNavigation(); },
  stop() {},
  showBoard() { if (!this.photoTask) this.setData({ sourceStage: false }); },
  libraryPrevious() { this.libraryTurn(-1); }, libraryNext() { this.libraryTurn(1); },
  libraryTurn(offset) { const page = Math.max(1, Math.min(this.data.libraryPageCount, this.data.libraryPage + offset)); this.setData({ libraryPage: page, visibleLibraryItems: this.data.libraryItems.slice((page - 1) * 3, page * 3) }); },
  openAppearance() { if (this.canAdjust()) { this.cancelGesture(); this.setData({ drawer: 'appearance' }); } },
  closeDrawer() { if (this.noteDirty && !this.saveNote()) return; this.setData({ drawer: '' }); },
  notifyChange() { if (this.data.embedded && this.triggerEvent && !this.disposed) this.triggerEvent('change'); },
  closeCard() { platform.unloadGuard(false); if (this.triggerEvent && !this.disposed) this.triggerEvent('close'); },
  placeFromLibrary(e) {
    if (!this.canAdjust()) return;
    try {
      const id = e.currentTarget.dataset.id;
      if (!this.data.libraryItems.some(item => item.id === id)) return;
      this.store.place(id, this.date); this.setData({ drawer: '' }); this.photoDone(id);
    } catch (error) { platform.toast(platform.message(error, '放入失败，请重试')); }
  },
  openNote(id) {
    if (this.noteDirty && !this.saveNote()) return;
    const memory = this.store.get().memories[id]; if (!memory) return;
    this.noteId = id;
    const draft = this.store.getMemoryDraft(id); this.noteDirty = !!draft;
    this.setData({ drawer: 'note', noteText: draft ? draft.text : memory.text, noteCategory: draft ? draft.category : Math.max(0, config.categories.indexOf(memory.category)), noteError: '', noteHint: draft ? '已恢复上次未保存的文字，保存后生效。' : '' });
    platform.unloadGuard(this.noteDirty);
  },
  keepNoteDraft() { if (this.noteId) this.store.keepMemoryDraft(this.noteId, { text: this.data.noteText, category: this.data.noteCategory }); platform.unloadGuard(true); },
  noteInput(e) { this.noteDirty = true; this.setData({ noteText: e.detail.value }); this.keepNoteDraft(); },
  noteCategoryInput(e) { this.noteDirty = true; this.setData({ noteCategory: Number(e.detail.value) }); this.keepNoteDraft(); },
  saveNote() {
    if (!this.noteId) return true;
    try {
      if (this.noteDirty) this.store.edit(this.noteId, this.data.noteText, config.categories[this.data.noteCategory]);
      this.store.clearMemoryDraft(this.noteId); this.noteDirty = false; this.setData({ noteError: '', noteHint: '文字与分类已保存', drawer: '' }); platform.unloadGuard(!!this.dirty || !!this.photoTask); this.display(); this.notifyChange(); return true;
    } catch (error) { this.setData({ noteError: platform.message(error, '文字未保存，请重试') }); this.keepNoteDraft(); return false; }
  },
  discardNote() { this.store.clearMemoryDraft(this.noteId); this.noteDirty = false; this.setData({ noteError: '', drawer: '' }); platform.unloadGuard(!!this.dirty || !!this.photoTask); },
  async back() {
    if (this.closing || this.data.recovering || this.mutating || this.data.photoAdjusting) return;
    if (this.data.shareBoardId) { const share = this.selectComponent && this.selectComponent('#share-card'); if (share) share.back(); return; }
    if (this.data.drawer) { this.closeDrawer(); return; }
    if (this.noteDirty && !this.saveNote()) return;
    this.closing = true;
    try {
    this.stickerLanded();
    if (this.photoTask) {
      const task = this.photoTask;
      if (!task.committed) {
        const r = await platform.call('showModal', { title: '取消照片处理？', content: '照片还没有保存，离开会取消本次处理。', confirmText: '离开', confirmColor: '#4D7D5B' });
        if (!r.confirm || this.disposed || this.photoTask && this.photoTask !== task) return;
      }
      if (this.photoTask === task) {
        if (task.committed) { if (!photo.finish(this, false)) return; }
        else await task.cancel();
      }
    }
    if (this.disposed) return;
    if (this.dirty && !this.persist()) {
      const r = await platform.call('showModal', { title: '布局尚未保存', content: '请重试保存；也可放弃未保存的布局，已保存的记忆会保留。', confirmText: '重试', cancelText: '放弃' });
      if (r.confirm) { this.persist(); return; } this.store.clearDraft(this.date); this.dirty = false;
    }
    platform.unloadGuard(false); if (this.data.embedded || options.modal) this.closeCard(); else platform.back();
    } finally { this.closing = false; }
  }
}; }
module.exports = { createBoardEditor };
