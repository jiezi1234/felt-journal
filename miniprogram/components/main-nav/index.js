const platform = require('../../services/platform');
Component({
  properties: { active: String },
  data: { navigating: false, items: [{ id: 'today', label: '今天' }, { id: 'board', label: '主题板' }, { id: 'calendar', label: '月历时光' }] },
  lifetimes: { detached() { this.disposed = true; } },
  methods: {
    async open(e) {
      const id = e.currentTarget.dataset.id;
      if (this.disposed || this.data.navigating) return;
      const routes = { today: '/pages/index/index', board: '/pages/board-tab/index', calendar: '/pages/calendar/index' };
      if (!routes[id]) return;
      const pages = getCurrentPages(), current = pages[pages.length - 1];
      if (current && `/${current.route}` === routes[id]) return;
      this.setData({ navigating: true });
      try {
        // Keep tab pages and their canvases alive; dated boards remain detail routes.
        await platform.call('switchTab', { url: routes[id] });
      } catch (error) {
        if (!this.disposed) platform.toast(platform.message(error, '页面暂时无法打开，请重试'));
      } finally { if (!this.disposed) this.setData({ navigating: false }); }
    }
  }
});
