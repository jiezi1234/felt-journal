const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const platform = require('../../services/platform');
Page({
  data: { loading: true, error: '', date: '', dateLabel: '', model: null, recent: [], count: 0, editorOpen: false, editorDate: '', startWithPhoto: false },
  onLoad() { this.store = getStore(); },
  onShow() { platform.syncTab(this, 'today', this.data.editorOpen); if (!this.data.editorOpen) this.refresh(); clearInterval(this.timer); this.timer = setInterval(() => { if (!this.data.editorOpen && dates.key() !== this.data.date) this.refresh(); }, 30000); },
  onHide() { clearInterval(this.timer); },
  onUnload() { clearInterval(this.timer); },
  refresh() {
    try {
      this.store.load();
      const date = dates.key(), state = this.store.get(), model = this.store.view(date);
      const recent = Object.keys(state.boards).filter(d => dates.valid(d) && d <= date && state.boards[d].placements.length && d !== date).sort().reverse().slice(0, 4).map(d => ({ date: d, label: dates.label(d), model: this.store.view(d), count: state.boards[d].placements.length }));
      this.setData({ date, dateLabel: dates.label(date), model, count: model.items.length, recent, loading: false, error: '' });
    } catch (e) { this.setData({ loading: false, error: platform.message(e, '本地记录读取失败，请重试') }); }
  },
  openBoard() { this.openEditor(false); },
  primary() { this.openEditor(true); },
  openEditor(startWithPhoto) {
    if (this.data.editorOpen || this.data.loading || this.data.error) return;
    this.refresh(); if (this.data.error) return;
    this.setData({ editorDate: this.data.date, startWithPhoto: !!startWithPhoto, editorOpen: true }); platform.syncTab(this, 'today', true);
  },
  editorChanged() { /* Keep the underlying page and its scroll in place until closing. */ },
  closeEditor() { this.setData({ editorOpen: false }); platform.syncTab(this, 'today'); this.refresh(); },
  openMemory(e) { if (e.detail && e.detail.id) wx.navigateTo({ url: `/pages/memory/index?id=${encodeURIComponent(e.detail.id)}` }); },
  exportToday() { if (this.data.count) wx.navigateTo({ url: `/pages/export/index?date=${this.data.date}` }); },
  recentBoard(e) { wx.navigateTo({ url: `/pages/board/index?date=${e.currentTarget.dataset.date}` }); },
  calendar() { wx.switchTab({ url: '/pages/calendar/index' }); },
  memories() { wx.navigateTo({ url: '/pages/memories/index' }); },
  themes() { wx.switchTab({ url: '/pages/board-tab/index' }); }
});
