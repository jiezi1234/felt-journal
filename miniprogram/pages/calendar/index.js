const { getStore } = require('../../core/store');
const dates = require('../../core/date');
const platform = require('../../services/platform');
Page({
  data: { loading: true, error: '', year: 0, month: 0, cells: [], weekdays: ['一', '二', '三', '四', '五', '六', '日'], canNext: false, itemCount: 0, dayCount: 0 },
  onLoad() { this.store = getStore(); const now = new Date(); this.year = now.getFullYear(); this.month = now.getMonth() + 1; },
  onShow() { platform.syncTab(this, 'calendar'); this.refresh(); clearInterval(this.timer); this.timer = setInterval(() => { if (dates.key() !== this.today) this.refresh(); }, 30000); },
  onHide() { clearInterval(this.timer); }, onUnload() { clearInterval(this.timer); },
  refresh() {
    try {
      this.store.load();
      const state = this.store.get(), previews = {}; let itemCount = 0, dayCount = 0;
      this.today = dates.key();
      const prefix = `${this.year}-${String(this.month).padStart(2, '0')}`;
      Object.keys(state.boards).filter(d => d.startsWith(prefix)).forEach(d => {
        const ps = state.boards[d].placements.slice().sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
        previews[d] = ps.slice(0, 2).map(p => ({ id: p.memoryId, path: state.memories[p.memoryId].subjectPath, missing: false }));
        itemCount += ps.length; if (ps.length) dayCount++;
      });
      this.setData({ year: this.year, month: this.month, cells: dates.monthCells(this.year, this.month, this.today, previews), canNext: prefix < this.today.slice(0, 7), itemCount, dayCount, loading: false, error: '' });
    } catch (e) { this.setData({ loading: false, error: platform.message(e, '月历读取失败，请重试') }); }
  },
  previous() { this.shift(-1); }, next() { if (this.data.canNext) this.shift(1); },
  shift(offset) { const next = dates.shiftMonth(this.year, this.month, offset); this.year = next.year; this.month = next.month; this.refresh(); },
  current() { const now = new Date(); this.year = now.getFullYear(); this.month = now.getMonth() + 1; this.refresh(); },
  open(e) { const d = e.currentTarget.dataset.date; if (!d || d > dates.key()) return; wx.navigateTo({ url: `/pages/board/index?date=${d}` }); },
  imageError(e) {
    const { cell, image } = e.currentTarget.dataset;
    this.setData({ [`cells[${cell}].images[${image}].missing`]: true });
  },
  memories() { wx.navigateTo({ url: `/pages/memories/index?month=${this.year}-${String(this.month).padStart(2, '0')}` }); },
  back() { platform.back(); }
});
