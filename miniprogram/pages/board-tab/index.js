const { getStore, boardLabel } = require('../../core/store');
const dates = require('../../core/date');
const platform = require('../../services/platform');

// A cached, read-only tab. Editing retains the existing dated page and its
// save/draft guards, so switching tabs can never discard work in progress.
Page({
  data: { loading: true, error: '', date: '', dateLabel: '', model: null, count: 0 },
  onLoad() { this.store = getStore(); },
  onShow() {
    platform.syncTab(this, 'board'); this.refresh(); clearInterval(this.timer);
    this.timer = setInterval(() => { if (dates.key() !== this.data.date) this.refresh(); }, 30000);
  },
  onHide() { clearInterval(this.timer); },
  onUnload() { clearInterval(this.timer); },
  refresh() {
    try {
      this.store.load();
      const date = dates.key(), model = this.store.view(date);
      this.setData({ loading: false, error: '', date, dateLabel: boardLabel(model), model, count: model.items.length });
    } catch (error) { this.setData({ loading: false, error: platform.message(error, '板面读取失败，请重试') }); }
  },
  edit() { this.openEditor(false); },
  sourceSheet() { this.openEditor(true); },
  async openEditor(add) {
    if (this.opening || this.data.loading || this.data.error) return;
    this.opening = true;
    try { await platform.call('navigateTo', { url: `/pages/board/index?date=${dates.key()}&mode=edit${add ? '&add=1' : ''}` }); }
    catch (error) { platform.toast(platform.message(error, '编辑页暂时无法打开')); }
    finally { this.opening = false; }
  },
  memory(e) {
    const id = e.detail && e.detail.id;
    if (id) wx.navigateTo({ url: `/pages/memory/index?id=${encodeURIComponent(id)}` });
  },
  exportBoard() { if (this.data.count) wx.navigateTo({ url: `/pages/export/index?date=${this.data.date}` }); },
  back() { platform.back(); }
});
