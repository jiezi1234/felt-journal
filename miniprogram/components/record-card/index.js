const { createBoardEditor } = require('../../services/board-editor');
const photo = require('../../services/page-photo');
const controller = createBoardEditor({ embedded: true });
const methods = {};
Object.keys(controller).forEach(key => { if (typeof controller[key] === 'function' && !key.startsWith('on')) methods[key] = controller[key]; });
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { boardId: String, lifting: Boolean },
  data: controller.data,
  lifetimes: {
    attached() { controller.onLoad.call(this, { date: this.data.boardId, mode: 'edit' }); this.setData({ sourceStage: true }); },
    ready() { controller.onShow.call(this); },
    detached() { controller.onUnload.call(this); }
  },
  pageLifetimes: { hide() { controller.onHide.call(this); }, show() { if (this.store) controller.onShow.call(this); }, resize() { controller.onResize.call(this); } },
  methods: { ...methods,
    cancelPhoto(e) {
      if (this.data.lifting || this.handingOff || this.data.photoAdjusting) return;
      if (!this.photoTask || !this.photoTask.committed) return controller.cancelPhoto.call(this, e);
      if (!photo.saveNote(this)) return;
      this.handingOff = true;
      this.triggerEvent('place', { id: this.data.selected, rect: e && e.detail && e.detail.rect });
    }
  }
});
