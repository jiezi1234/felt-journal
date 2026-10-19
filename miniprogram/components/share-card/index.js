const { createShareExport } = require('../../services/share-export');
const controller = createShareExport();
const methods = {};
Object.keys(controller).forEach(key => { if (typeof controller[key] === 'function' && !key.startsWith('on')) methods[key] = controller[key]; });

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { boardId: String },
  data: { ...controller.data, styleOpen: false },
  lifetimes: {
    attached() { controller.onLoad.call(this, { board: this.data.boardId }); },
    ready() { this.generate(); },
    detached() { controller.onUnload.call(this); }
  },
  methods: { ...methods,
    stop() {},
    openAppearance() { if (!this.disposed && this.data.previewColor && !this.data.generating && !this.data.saving && !this.data.sharing) this.setData({ styleOpen: true }); },
    closeAppearance() { this.setData({ styleOpen: false }); },
    back() { if (this.data.styleOpen) this.closeAppearance(); else this.close(); },
    close() {
      if (this.disposed || this.data.saving || this.data.sharing) return;
      this.disposed = true; this.triggerEvent('close');
    }
  }
});
