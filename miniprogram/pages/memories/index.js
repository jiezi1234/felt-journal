const { getStore, boardLabel } = require('../../core/store');
const dates = require('../../core/date');
const search = require('../../core/memory-query');
const platform = require('../../services/platform');
Page({
  data: { loading: true, error: '', scope: 'all', month: '', monthLabel: '', maxMonth: '', category: '', categories: [], groups: [], total: 0, scopeTotal: 0,
    page: 1, pageCount: 1, pageSize: 4, hasPrevious: false, hasNext: false, opening: false, summary: '', emptyTitle: '', emptyHint: '', targetId: '', targetTitle: '', targetDaily: false, placing: false },
  onLoad(options = {}) {
    this.store = getStore(); this.missingPaths = new Set(); this.target = options.target || '';
    const today = dates.key(), filter = search.normalize(options, today);
    this.setData({ category: filter.category, scope: filter.month ? 'month' : 'all', month: filter.month || today.slice(0, 7), maxMonth: today.slice(0, 7) });
    this.resizeResults();
  },
  onShow() { this.refresh(); },
  onResize() { this.resizeResults(); this.refresh(); },
  resizeResults() {
    if (typeof wx === 'undefined') return;
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync(), pageSize = info.windowHeight < 600 ? 2 : 4;
    const page = Math.floor((this.data.page - 1) * this.data.pageSize / pageSize) + 1;
    this.setData({ pageSize, page });
  },
  onUnload() { this.disposed = true; },
  refresh() {
    try {
      const today = dates.key(), month = search.validMonth(this.data.month, today) ? this.data.month : today.slice(0, 7);
      const state = this.store.load(), target = this.target ? this.store.board(this.target) : null, targetDaily = !!target && target.type !== 'theme';
      if (target && !this.store.canEdit(target.id)) throw new Error('当前板面暂不能添加记忆');
      const result = search.query(state, { category: this.data.category, date: targetDaily ? target.date : '', month: !targetDaily && this.data.scope === 'month' ? month : '', page: this.data.page, pageSize: this.data.pageSize }, today);
      const monthLabel = `${month.slice(0, 4)}年${Number(month.slice(5))}月`, period = targetDaily ? boardLabel(target) : this.data.scope === 'month' ? monthLabel : '全部时间';
      result.groups.forEach(group => group.items.forEach(item => { item.missing = this.missingPaths.has(item.path); item.placed = !!target && target.placements.some(p => p.memoryId === item.id); }));
      const emptyTitle = result.category ? `还没有「${result.category}」记忆` : result.month ? '这个月还没有记录' : '从一张照片开始收藏';
      const emptyHint = result.category ? '可以换个分类，或在记忆详情中补充分类。' : result.month ? '试着查看其他月份，或切换到全部时间。' : target ? '先在今日板记录，再把喜欢的记忆放进来。' : '记录时可以先不分类，之后再慢慢整理。';
      this.setData({ ...result, month, monthLabel, maxMonth: today.slice(0, 7), summary: `${period} · ${result.category || '全部分类'} · ${result.total} 件`,
        loading: false, error: '', emptyTitle, emptyHint, targetId: target ? target.id : '', targetTitle: target ? boardLabel(target) : '', targetDaily });
    } catch (error) { this.setData({ loading: false, error: platform.message(error, '记忆读取失败，请重试'), groups: [], total: 0, scopeTotal: 0, categories: [], hasPrevious: false, hasNext: false }); }
  },
  category(e) {
    const category = e.currentTarget.dataset.category;
    if (this.data.loading || !this.data.categories.some(item => item.value === category) || category === this.data.category) return;
    this.setData({ category, page: 1 }); this.refresh();
  },
  scope(e) {
    if (this.data.targetDaily) return;
    const scope = e.currentTarget.dataset.scope;
    if (!['all', 'month'].includes(scope) || this.data.scope === scope || this.data.loading) return;
    this.setData({ scope, page: 1 }); this.refresh();
  },
  month(e) {
    if (this.data.targetDaily) return;
    const month = e.detail.value;
    if (!search.validMonth(month, dates.key()) || this.data.loading || this.data.month === month && this.data.scope === 'month') return;
    this.setData({ month, scope: 'month', page: 1 }); this.refresh();
  },
  clearCategory() { this.setData({ category: '', page: 1 }); this.refresh(); },
  allTime() { this.setData({ scope: 'all', page: 1 }); this.refresh(); },
  previous() { this.turn(-1); }, next() { this.turn(1); },
  turn(offset) {
    if (this.data.loading || this.data.error || offset < 0 && !this.data.hasPrevious || offset > 0 && !this.data.hasNext) return;
    this.setData({ page: this.data.page + offset }); this.refresh();
  },
  imageError(e) {
    const { id, path } = e.currentTarget.dataset;
    if (!this.data.groups.some(group => group.items.some(item => item.id === id && item.path === path))) return;
    this.missingPaths.add(path);
    this.setData({ groups: this.data.groups.map(group => ({ ...group, items: group.items.map(item => item.path === path ? { ...item, missing: true } : item) })) });
  },
  async navigate(url) {
    if (this.data.opening || this.disposed) return;
    this.setData({ opening: true });
    try { await platform.call('navigateTo', { url }); }
    catch (error) { if (!this.disposed) platform.toast(platform.message(error, '页面暂时无法打开，请重试')); }
    finally { if (!this.disposed) this.setData({ opening: false }); }
  },
  open(e) {
    if (this.data.error || this.data.loading || this.data.placing) return;
    const id = e.currentTarget.dataset.id;
    if (!this.data.groups.some(group => group.items.some(item => item.id === id))) return;
    if (this.target) return this.place(id);
    return this.navigate(`/pages/memory/index?id=${encodeURIComponent(id)}&from=memories`);
  },
  async place(id) {
    if (this.disposed || this.data.placing || this.data.opening) return;
    const item = this.data.groups.flatMap(group => group.items).find(item => item.id === id);
    if (!item || item.placed || !this.target) return;
    this.setData({ placing: true });
    try {
      this.store.place(id, this.target);
      if (this.getOpenerEventChannel) { const channel = this.getOpenerEventChannel(); if (channel && channel.emit) channel.emit('placed', { id, boardId: this.target }); }
      platform.back();
    } catch (error) { this.setData({ placing: false }); platform.toast(platform.message(error, '添加未完成，请重试')); this.refresh(); }
  },
  board(e) {
    const date = e.currentTarget.dataset.date;
    if (this.data.error || this.data.loading || !this.data.groups.some(group => group.date === date)) return;
    return this.navigate(`/pages/board/index?date=${date}`);
  },
  record() { return this.navigate(`/pages/board/index?date=${dates.key()}&mode=edit&add=1`); },
  back() { platform.back(); }
});
