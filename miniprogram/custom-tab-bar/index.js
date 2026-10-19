Component({
  data: { active: '', hidden: false },
  lifetimes: { attached() { this.sync(); } },
  pageLifetimes: { show() { this.sync(); } },
  methods: {
    sync() {
      const pages = getCurrentPages(), page = pages[pages.length - 1];
      const tabs = { 'pages/index/index': 'today', 'pages/board-tab/index': 'board', 'pages/calendar/index': 'calendar' };
      if (page && tabs[page.route]) this.setData({ active: tabs[page.route], hidden: !!(page.data.editorOpen || page.data.formOpen) });
    }
  }
});
