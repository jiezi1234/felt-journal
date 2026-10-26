const { createBoardEditor } = require('../../services/board-editor');
const photo = require('../../services/page-photo');
const modal = require('../../services/modal-presentation');
const controller = createBoardEditor({ embedded: true });
const methods = {};
Object.keys(controller).forEach(key => { if (typeof controller[key] === 'function' && !key.startsWith('on')) methods[key] = controller[key]; });
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { boardId: String, lifting: Boolean },
  data: controller.data,
  lifetimes: {
    attached() { modal.mount(this); controller.onLoad.call(this, { date: this.data.boardId, mode: 'edit' }); this.setData({ sourceStage: true }); },
    ready() { controller.onShow.call(this); },
    detached() { modal.dispose(this); controller.onUnload.call(this); }
  },
  pageLifetimes: { hide() { controller.onHide.call(this); }, show() { if (this.store) controller.onShow.call(this); }, resize() { controller.onResize.call(this); } },
  methods: { ...methods,
    closeCard() { modal.close(this, () => controller.closeCard.call(this)); },
    continuePhoto(e) {
      const id = photo.confirmPlacement(this); if (!id) return;
      this.handingOff = true;
      this.triggerEvent('place', { id, rect: e && e.detail && e.detail.rect });
    }
  }
});
