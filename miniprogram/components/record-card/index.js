const { createBoardEditor } = require('../../services/board-editor');
const controller = createBoardEditor({ embedded: true });
const methods = {};
Object.keys(controller).forEach(key => { if (typeof controller[key] === 'function' && !key.startsWith('on')) methods[key] = controller[key]; });
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { boardId: String, startWithPhoto: Boolean },
  data: controller.data,
  lifetimes: {
    attached() { controller.onLoad.call(this, { date: this.data.boardId, mode: 'edit' }); this.setData({ sourceStage: this.data.startWithPhoto }); },
    ready() { controller.onShow.call(this); },
    detached() { controller.onUnload.call(this); }
  },
  pageLifetimes: { hide() { controller.onHide.call(this); }, show() { if (this.store) controller.onShow.call(this); }, resize() { controller.onResize.call(this); } },
  methods
});
