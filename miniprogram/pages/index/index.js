const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const platform = require('../../services/platform');
Page({
  data: { loading: true, error: '', date: '', dateLabel: '', model: null, recent: [], count: 0 },
  onLoad() { this.store = getStore(); },
  onShow() { platform.syncTab(this, 'today'); this.refresh(); clearInterval(this.timer); this.timer = setInterval(() => { if (dates.key() !== this.data.date) this.refresh(); }, 30000); },
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
  openBoard() { wx.navigateTo({ url: `/pages/board/index?date=${this.data.date}` }); },
  primary() { wx.navigateTo({ url: `/pages/board/index?date=${this.data.date}&mode=edit${this.data.count ? '' : '&add=1'}` }); },
  recentBoard(e) { wx.navigateTo({ url: `/pages/board/index?date=${e.currentTarget.dataset.date}` }); },
  calendar() { wx.switchTab({ url: '/pages/calendar/index' }); },
  memories() { wx.navigateTo({ url: '/pages/memories/index' }); },
  themes() { wx.navigateTo({ url: '/pages/themes/index' }); }
});
