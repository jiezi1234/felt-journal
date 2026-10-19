const { getStore } = require('../core/store');
const { newId } = require('./photo-task');
const config = require('../core/config');
const platform = require('./platform');
function createThemePage(options = {}) { return {
  data: { isTab: !!options.tab, loading: true, error: '', themes: [], visibleThemes: [], page: 1, pageCount: 1, selecting: false, working: false, formOpen: false, editingId: '', title: '', formError: '', maxTitle: config.maxBoardTitle, maxItems: config.maxItems },
  onLoad(options = {}) { this.store = getStore(); this.memoryId = options.memory || ''; this.setData({ selecting: !!this.memoryId }); },
  onShow() { this.syncNavigation(); this.refresh(); }, onUnload() { this.disposed = true; },
  syncNavigation() { if (options.tab) platform.syncTab(this, 'board', this.data.formOpen); },
  refresh() {
    try {
      const state = this.store.load();
      if (this.memoryId && !state.memories[this.memoryId]) throw new Error('这条记忆已被删除，请返回记忆库');
      const themes = Object.values(state.boards).filter(b => b.type === 'theme').sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(b => ({
        id: b.id, title: b.title, color: b.color, count: b.placements.length, placed: b.placements.some(p => p.memoryId === this.memoryId),
        images: b.placements.slice(0, 3).map(p => ({ id: p.memoryId, path: state.memories[p.memoryId].subjectPath }))
      }));
      const pageCount = Math.max(1, themes.length), page = Math.min(this.data.page, pageCount);
      this.setData({ themes, visibleThemes: themes.slice(page - 1, page), page, pageCount, loading: false, error: '' });
    } catch (error) { this.setData({ loading: false, error: platform.message(error, '主题板读取失败，请重试'), themes: [] }); }
  },
  previous() { this.turn(-1); }, next() { this.turn(1); },
  turn(offset) { if (this.data.working) return; this.setData({ page: Math.max(1, Math.min(this.data.pageCount, this.data.page + offset)) }); this.refresh(); },
  stop() {},
  create() { if (this.data.working || this.data.error) return; this.createId = newId(); this.setData({ formOpen: true, editingId: '', title: '', formError: '' }); this.syncNavigation(); },
  rename(e) { if (this.data.working) return; const item = this.data.themes.find(t => t.id === e.currentTarget.dataset.id); if (item) { this.setData({ formOpen: true, editingId: item.id, title: item.title, formError: '' }); this.syncNavigation(); } },
  input(e) { this.setData({ title: e.detail.value }); },
  cancelForm() { if (!this.data.working) { this.setData({ formOpen: false, formError: '' }); this.syncNavigation(); } },
  async save() {
    if (this.data.working || !this.data.formOpen) return;
    this.setData({ working: true, formError: '' });
    try {
      const editing = this.data.editingId;
      if (editing) this.store.renameTheme(editing, this.data.title);
      else this.store.createTheme(this.createId, this.data.title, this.memoryId);
      const id = editing || `theme_${this.createId}`;
      this.setData({ formOpen: false, title: '', editingId: '', page: 1 }); this.syncNavigation(); this.refresh();
      if (!editing) {
        if (this.memoryId) { platform.toast('已放入主题板'); platform.back(); }
        else await platform.call('navigateTo', { url: `/pages/board/index?board=${id}&mode=edit` });
      }
    } catch (error) { if (!this.disposed) { const message = platform.message(error, '主题板保存失败，请重试'); if (this.data.formOpen) this.setData({ formError: message }); else platform.toast(message); } }
    finally { if (!this.disposed) this.setData({ working: false }); }
  },
  async open(e) {
    if (this.data.working || this.data.error) return;
    const item = this.data.themes.find(t => t.id === e.currentTarget.dataset.id); if (!item) return;
    if (this.memoryId && (item.placed || item.count >= config.maxItems)) return;
    this.setData({ working: true });
    try {
      if (this.memoryId) { this.store.place(this.memoryId, item.id); platform.toast('已放入主题板'); platform.back(); }
      else await platform.call('navigateTo', { url: `/pages/board/index?board=${item.id}` });
    } catch (error) { if (!this.disposed) { platform.toast(platform.message(error, '操作未完成，请重试')); this.refresh(); } }
    finally { if (!this.disposed) this.setData({ working: false }); }
  },
  async remove(e) {
    if (this.data.working || this.data.selecting) return;
    const item = this.data.themes.find(t => t.id === e.currentTarget.dataset.id); if (!item) return;
    this.setData({ working: true });
    try {
      const result = await platform.call('showModal', { title: '删除这块主题板？', content: `「${item.title}」及其中的布局会被移除，照片、文字和其他板面都会保留。`, confirmText: '删除板面', confirmColor: '#A44737' });
      if (!result.confirm || this.disposed) return;
      this.store.deleteTheme(item.id); this.refresh();
    } catch (error) { if (!this.disposed) platform.toast(platform.message(error, '板面删除失败，请重试')); }
    finally { if (!this.disposed) this.setData({ working: false }); }
  },
  back() { if (!this.data.working) platform.back(); }
}; }
module.exports = { createThemePage };
