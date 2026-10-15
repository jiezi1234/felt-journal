const { getStore } = require('./core/store');
App({
  globalData: { loadError: '' },
  onLaunch() {
    try {
      const store = getStore(); store.load();
      require('./services/platform').sweepUnused(store).catch(() => {});
    } catch (e) { this.globalData.loadError = e.message || '本地记录读取失败'; }
  }
});
