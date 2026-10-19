const { createBoardEditor } = require('../../services/board-editor');
const platform = require('../../services/platform');
const controller = createBoardEditor({ inline: true, modal: true });
const methods = {};
Object.keys(controller).forEach(key => { if (typeof controller[key] === 'function' && !key.startsWith('on')) methods[key] = controller[key]; });

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { boardDate: String },
  data: controller.data,
  lifetimes: {
    attached() { controller.onLoad.call(this, { date: this.data.boardDate }); },
    ready() { this.refresh(); },
    detached() { controller.onUnload.call(this); }
  },
  pageLifetimes: {
    hide() { controller.onHide.call(this); },
    show() { if (this.store && !this.data.shareBoardId) this.refresh(); },
    resize() { controller.onResize.call(this); }
  },
  methods: { ...methods,
    refresh() {
      if (this.disposed) return;
      try { this.store.load(); controller.refresh.call(this); }
      catch (error) { this.setData({ loading: false, error: platform.message(error, '板面读取失败，请重试') }); }
    },
    // Closing the outer card must not discard a nested memory's unsaved text.
    close() { if (!this.data.memoryCardId) return controller.back.call(this); },
    notifyChange() { if (!this.disposed) this.triggerEvent('change'); },
    persist() { const saved = controller.persist.call(this); if (saved) this.notifyChange(); return saved; },
    async remove() { await controller.remove.call(this); if (!this.data.selected) this.closeDrawer(); this.notifyChange(); },
    memoryCardChanged() { this.refresh(); this.notifyChange(); },
    openSelection() {
      if (!this.data.canEdit || this.data.loading || this.data.error || this.data.drawer || this.data.shareBoardId || this.data.memoryCardId || this.data.task || this.photoTask || this.data.placing || this.data.recovering || this.data.openingLibrary || this.mutating) return;
      this.edit();
      if (this.canAdjust()) { this.cancelGesture(); this.setData({ drawer: 'selection' }); }
    }
  }
});
