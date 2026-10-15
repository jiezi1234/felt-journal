const { PhotoTask } = require('./photo-task');
const platform = require('./platform');
function begin(page, source, options) {
  if (page.photoTask) return;
  page.photoSource = source;
  page.photoTask = new PhotoTask(Object.assign({}, options, {
    store: page.store,
    onState(task) { if (!page.disposed) { page.setData({ task }); platform.unloadGuard(true, '照片尚未保存，离开将取消处理。'); } },
    onDone(id) { page.photoTask = null; if (page.disposed) return; page.setData({ task: null }); platform.unloadGuard(false); page.photoDone(id); platform.localNotice(page.store).catch(() => {}); },
    onCancel() { page.photoTask = null; if (!page.disposed) { page.setData({ task: null }); platform.unloadGuard(false); } }
  }));
  page.photoTask.start(source);
}
function retry(page) {
  const task = page.photoTask; if (!task) return;
  if (page.data.task.state === 'saveError') task.save();
  else if (page.data.task.state === 'sourceError') { const options = { date: task.date, memoryId: task.memoryId }; task.cancel().then(() => begin(page, page.photoSource, options)); }
  else task.process(false);
}
function cancel(page) { if (page.photoTask) page.photoTask.cancel(); }
function original(page) { if (page.photoTask) page.photoTask.process(true); }
function dispose(page) { page.disposed = true; cancel(page); }
module.exports = { begin, retry, cancel, original, dispose };
