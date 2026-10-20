const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const config = require('../../core/config');
const platform = require('../../services/platform');
const photo = require('../../services/page-photo');
Page({
  data: { loading: true, error: '', memory: null, editing: false, section: 'subject', text: '', category: 0, categories: config.categories, maxText: config.maxText, saveError: '', contentStatus: '', task: null, originalMissing: false, subjectMissing: false, backLabel: '返回原板' },
  onLoad(query) { this.store = getStore(); this.id = query.id; if (query.from === 'memories') this.setData({ backLabel: '返回筛选结果' }); else if (query.from === 'theme') this.setData({ backLabel: '返回主题板' }); },
  onShow() { this.refresh(); },
  onUnload() { if (this.dirty) this.store.keepMemoryDraft(this.id, { text: this.data.text, category: this.data.category }); photo.dispose(this); platform.unloadGuard(false); },
  refresh() {
    try {
      photo.refreshResult(this);
      const m = this.store.get().memories[this.id]; if (!m) throw new Error('这条记忆已被删除或无法读取');
      const used = this.store.boardsForMemory(this.id);
      const data = { memory: m, dateLabel: dates.label(m.date), loading: false, error: '', usageCount: used.length,
        usageLabel: used.length ? `已放在 ${used.length} 块板上 · 修改照片和文字会同步到所有板面` : '暂未摆放 · 照片与文字仍保留在记忆库' };
      if (!this.data.memory || m.subjectPath !== this.data.memory.subjectPath) data.subjectMissing = false;
      if (!this.data.memory || m.originalPath !== this.data.memory.originalPath) data.originalMissing = false;
      if (!this.dirty) Object.assign(data, { text: m.text, category: config.categories.indexOf(m.category) });
      this.setData(data);
      if (!this.checkedDraft) { this.checkedDraft = true; this.recoverDraft(); }
    } catch (e) { this.setData({ loading: false, error: platform.message(e) }); }
  },
  section(e) { const section = e.currentTarget.dataset.section; if (['original', 'subject', 'note'].includes(section)) this.setData({ section }); },
  edit() { this.setData({ editing: true, section: 'note' }); },
  async recoverDraft() {
    const draft = this.store.getMemoryDraft(this.id); if (!draft) return;
    if (draft.text === this.data.memory.text && config.categories[draft.category] === this.data.memory.category) { this.store.clearMemoryDraft(this.id); return; }
    const result = await platform.call('showModal', { title: '发现未保存的文字', content: '是否恢复上次未保存的记忆文字和分类？', confirmText: '恢复', cancelText: '放弃' });
    if (this.disposed) return;
    if (result.confirm) { this.dirty = true; this.setData({ editing: true, section: 'note', text: draft.text, category: draft.category }); platform.unloadGuard(true); }
    else this.store.clearMemoryDraft(this.id);
  },
  keepContentDraft() { this.store.keepMemoryDraft(this.id, { text: this.data.text, category: this.data.category }); platform.unloadGuard(true); },
  textInput(e) { this.dirty = true; this.setData({ text: e.detail.value }); this.keepContentDraft(); },
  categoryInput(e) { this.dirty = true; this.setData({ category: Number(e.detail.value) }); this.keepContentDraft(); },
  save() {
    try {
      this.store.edit(this.id, this.data.text, config.categories[this.data.category]); this.dirty = false; this.store.clearMemoryDraft(this.id);
      this.setData({ saveError: '', contentStatus: '文字与分类已保存', editing: false }); platform.unloadGuard(!!this.photoTask); this.refresh(); return true;
    } catch (e) { this.setData({ contentStatus: '保存失败', saveError: platform.message(e, '文字未保存，请重试') }); return false; }
  },
  preview() { if (!this.data.originalMissing) platform.call('previewImage', { urls: [this.data.memory.originalPath], current: this.data.memory.originalPath }).catch(e => platform.toast(platform.message(e, '原图无法读取'))); },
  originalError() { this.setData({ originalMissing: true }); }, subjectError() { this.setData({ subjectMissing: true }); },
  async adjust() {
    if (this.photoTask || this.adjusting || this.dirty && !this.save()) return;
    this.adjusting = true;
    try { await platform.call('navigateTo', { url: `/pages/photo-edit/index?id=${encodeURIComponent(this.id)}` }); }
    catch (error) { platform.toast(platform.message(error, '图片调整暂时无法打开')); }
    finally { this.adjusting = false; }
  },
  async replace() {
    if (this.photoTask || this.dirty && !this.save()) return;
    try { const r = await platform.call('showActionSheet', { itemList: ['拍照替换', '从相册替换'] }); photo.begin(this, r.tapIndex === 0 ? 'camera' : 'album', { date: this.data.memory.date, memoryId: this.id }); } catch (_) { /* Cancelled. */ }
  },
  photoDone() { this.setData({ originalMissing: false, subjectMissing: false }); this.refresh(); },
  retryPhoto() { photo.retry(this); }, originalPhoto() { photo.original(this); }, cancelPhoto() { photo.cancel(this); },
  adjustPhoto() { return photo.adjustResult(this); },
  openPhotoNote() { photo.openNote(this); }, photoNoteInput(e) { photo.inputNote(this, e); },
  async remove() {
    if (this.photoTask || this.removing) return; this.removing = true;
    try {
      if (!await platform.confirmDelete(this.store.boardsForMemory(this.id).length) || this.disposed) return;
      this.store.remove(this.id); this.store.clearMemoryDraft(this.id); this.dirty = false; platform.unloadGuard(false); platform.collect(this.store).catch(() => {}); platform.back();
    }
    catch (e) { platform.toast(platform.message(e, '删除失败，原记录已保留')); }
    finally { this.removing = false; }
  },
  async back() {
    if (this.closing || this.data.photoAdjusting) return;
    this.closing = true;
    try {
      const task = this.photoTask;
      if (task) {
        if (!task.committed) {
          const r = await platform.call('showModal', { title: '取消照片替换？', content: '离开会取消本次处理，原照片和布局保持不变。', confirmText: '离开' });
          if (!r.confirm || this.disposed || this.photoTask && this.photoTask !== task) return;
        }
        if (this.photoTask === task) {
          if (task.committed) { if (!photo.finish(this, false)) return; }
          else await task.cancel();
        }
      }
      if (this.disposed || this.dirty && !this.save()) return;
      platform.unloadGuard(false); platform.back();
    } finally { this.closing = false; }
  }
});
