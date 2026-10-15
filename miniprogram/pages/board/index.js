const { getStore, isThemeId, boardLabel, membership } = require('../../core/store');
const { createBoardHistory } = require('../../core/board-history');
const layers = require('../../core/layers');
const dates = require('../../core/date');
const config = require('../../core/config');
const geometry = require('../../core/geometry');
const platform = require('../../services/platform');
const photo = require('../../services/page-photo');
Page({
  data: { loading: true, error: '', date: '', dateLabel: '', isTheme: false, editable: false, canEdit: false, selected: '', model: null, count: 0, saveState: '已保存', saveError: '', task: null, colors: config.colors, textures: config.textures, appearanceLabel: '', canUndo: false, canRedo: false, canBringToFront: false, canSendToBack: false, recovering: false, openingLibrary: false },
  onLoad(query) {
    this.store = getStore(); this.date = query.board || query.date || dates.key(); this.wantEdit = query.mode === 'edit'; this.wantAdd = query.add === '1';
  },
  onShow() { this.refresh(); },
  onReady() { if (this.wantAdd && !this.data.error) { this.wantAdd = false; this.sourceSheet(); } },
  onHide() { this.cancelGesture(); if (this.dirty) this.persist(); },
  onUnload() { if (this.dirty) { this.store.keepDraft(this.draft); this.persist(); } photo.dispose(this); platform.unloadGuard(false); },
  refresh() {
    try {
      if (!isThemeId(this.date) && (!dates.valid(this.date) || this.date > dates.key())) throw new Error('不能进入未来或无效日期');
      const saved = this.store.board(this.date); if (!this.dirty) this.draft = saved;
      if (!this.history) this.history = createBoardHistory(this.draft, config.historyLimit);
      else this.history.sync(this.draft);
      const canEdit = this.store.canEdit(this.date);
      this.setData({ loading: false, error: '', date: this.date, dateLabel: boardLabel(this.draft), isTheme: this.draft.type === 'theme', canEdit, editable: canEdit && (this.data.editable || this.wantEdit), selected: this.pendingSelection || this.data.selected }); this.wantEdit = false; this.pendingSelection = '';
      this.display();
      if (!this.checkedDraft) { this.checkedDraft = true; this.recoverDraft(); }
    } catch (e) { this.setData({ loading: false, error: platform.message(e, '板面读取失败，请重试') }); }
  },
  display() {
    const memories = this.store.get().memories;
    const items = layers.ordered(this.draft.placements).map(p => Object.assign({}, p, { memory: memories[p.memoryId] })).filter(p => p.memory);
    const selected = items.some(p => p.memoryId === this.data.selected) ? this.data.selected : '';
    const color = config.colors.find(c => c.value === this.draft.color), texture = config.textures.find(t => t.value === this.draft.texture);
    this.setData(Object.assign({ model: Object.assign({}, this.draft, { items }), count: items.length, selected, appearanceLabel: `${color ? color.name : ''} · ${texture ? texture.name : ''}` }, this.history.status(), layers.availability(this.draft, selected)));
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
  canAdjust() { return this.data.editable && !this.photoTask && !this.data.recovering && !this.mutating && !this.data.openingLibrary; },
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
    this.setData({ saveState: '保存中…' });
    try {
      this.store.saveBoard(this.draft); this.dirty = false; platform.unloadGuard(!!this.photoTask);
      this.setData({ saveState: '已保存', saveError: '' }); return true;
    } catch (e) {
      this.dirty = true; const durable = this.store.keepDraft(this.draft);
      this.setData({ saveState: '保存失败，请重试', saveError: platform.message(e, '保存未完成') + (durable ? '' : '。请保持当前页面，稍后重试') }); return false;
    }
  },
  retrySave() { this.persist(); },
  edit() { if (this.data.canEdit && !this.data.editable && !this.photoTask && !this.data.recovering) { this.history.reset(this.draft); this.setData({ editable: true }); this.display(); } },
  done() { if (!this.canAdjust()) return; this.cancelGesture(); if (this.persist()) { this.history.reset(this.draft); this.setData({ editable: false, selected: '' }); this.display(); } },
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
    const id = e && e.detail && e.detail.id || this.data.selected; if (!id || this.photoTask || this.data.recovering) return;
    this.cancelGesture();
    if (this.dirty && !this.persist()) { platform.toast('请先重试保存当前布局'); return; }
    wx.navigateTo({ url: `/pages/memory/index?id=${encodeURIComponent(id)}${this.data.isTheme ? '&from=theme' : ''}` });
  },
  async sourceSheet() {
    if (this.data.isTheme) return this.library();
    if (!this.data.canEdit || this.photoTask || this.data.error || this.data.recovering) return;
    try { const r = await platform.call('showActionSheet', { itemList: ['拍一张照片', '从相册选择一张'] }); this.add(r.tapIndex === 0 ? 'camera' : 'album'); } catch (_) { /* User cancelled. */ }
  },
  camera() { this.add('camera'); }, album() { this.add('album'); },
  add(source) {
    if (isThemeId(this.date) || !this.store.canEdit(this.date) || this.photoTask || this.data.recovering || this.mutating) return;
    this.cancelGesture();
    if (this.draft.placements.length >= config.maxItems) { platform.toast(`每块板最多 ${config.maxItems} 件记忆`); return; }
    if (this.dirty && !this.persist()) { platform.toast('请先保存当前布局'); return; }
    photo.begin(this, source, { date: this.date });
  },
  photoDone(id) { this.draft = this.store.board(this.date); this.history.reset(this.draft); this.setData({ selected: id, editable: true, canEdit: true }); this.display(); },
  retryPhoto() { photo.retry(this); }, originalPhoto() { photo.original(this); }, cancelPhoto() { photo.cancel(this); },
  async library() {
    if (!this.data.canEdit || this.data.error || this.photoTask || this.data.recovering || this.data.openingLibrary || this.mutating) return;
    this.cancelGesture(); if (this.dirty && !this.persist()) return;
    if (this.draft.placements.length >= config.maxItems) { platform.toast(`每块板最多 ${config.maxItems} 件记忆`); return; }
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
    const selected = this.data.selected; this.mutating = true;
    try {
      if (!await platform.confirmRemovePlacement() || this.disposed) return;
      this.store.unplace(selected, this.date); this.draft = this.store.board(this.date); this.history.reset(this.draft); this.setData({ selected: '' }); this.refresh();
    } catch (e) { if (!this.disposed) platform.toast(platform.message(e, '移除失败，请重试')); }
    finally { this.mutating = false; }
  },
  exportBoard() {
    if (!this.data.count || this.photoTask || this.dirty && !this.persist()) return;
    wx.navigateTo({ url: `/pages/export/index?${this.data.isTheme ? 'board' : 'date'}=${encodeURIComponent(this.date)}` });
  },
  async back() {
    if (this.photoTask) {
      const r = await platform.call('showModal', { title: '取消照片处理？', content: '照片还没有保存，离开会取消本次处理。', confirmText: '离开', confirmColor: '#4D7D5B' });
      if (!r.confirm) return; await this.photoTask.cancel();
    }
    if (this.dirty && !this.persist()) {
      const r = await platform.call('showModal', { title: '布局尚未保存', content: '请重试保存；也可放弃未保存的布局，已保存的记忆会保留。', confirmText: '重试', cancelText: '放弃' });
      if (r.confirm) { this.persist(); return; } this.store.clearDraft(this.date); this.dirty = false;
    }
    platform.unloadGuard(false); platform.back();
  }
});
