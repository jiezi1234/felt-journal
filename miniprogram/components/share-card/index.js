const { createShareExport } = require('../../services/share-export');
const modal = require('../../services/modal-presentation');
const controller = createShareExport();
const methods = {};
Object.keys(controller).forEach(key => { if (typeof controller[key] === 'function' && !key.startsWith('on')) methods[key] = controller[key]; });

Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { boardId: String, viewport: Object },
  data: { ...controller.data, styleOpen: false },
  lifetimes: {
    attached() { modal.mount(this); controller.onLoad.call(this, { board: this.data.boardId }); this.exportViewport = this.data.viewport; },
    ready() { this.generate(); },
    detached() { modal.dispose(this); controller.onUnload.call(this); }
  },
  methods: { ...methods,
    stop() {},
    openAppearance() { if (!this.disposed && this.data.previewColor && !this.data.generating && !this.data.saving && !this.data.sharing) this.setData({ styleOpen: true }); },
    closeAppearance() { this.setData({ styleOpen: false }); },
    back() { if (this.data.styleOpen) this.closeAppearance(); else this.close(); },
    close() {
      if (this.disposed || this.data.saving || this.data.sharing) return;
      if (this.data.styleOpen) { this.closeAppearance(); return; }
      modal.close(this, () => { this.disposed = true; this.triggerEvent('close'); });
    }
  }
});
