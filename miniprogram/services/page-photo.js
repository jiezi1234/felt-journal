const { PhotoTask } = require('./photo-task');
const platform = require('./platform');
const config = require('../core/config');
function current(page, task) { return !page.disposed && page.photoTask === task; }
function guard(page) {
  const pending = page.photoTask && !page.photoTask.committed;
  platform.unloadGuard(!!pending || !!page.dirty || !!page.noteDirty || !!page.photoNoteDirty, pending ? '照片尚未保存，离开将取消处理。' : undefined);
  if (page.syncNavigation) page.syncNavigation();
}
function begin(page, source, options) {
  if (page.disposed || page.photoTask) return;
  page.photoSource = source;
  page.photoNoteId = ''; page.photoNoteDirty = false;
  page.setData({ photoNoteOpen: false, photoNoteText: '', photoNoteError: '' });
  const task = new PhotoTask(Object.assign({}, options, {
    store: page.store, requireConfirmation: false,
    onState(snapshot) { if (current(page, task)) { page.setData({ task: snapshot }); guard(page); } },
    // Refresh the saved model now, while keeping the result visible until Continue.
    // A close/unload must never write an older board draft over the new memory.
    onDone(id) { if (current(page, task)) { page.photoNoteId = id; page.setData({ photoNoteText: page.store.get().memories[id].text }); page.photoDone(id); guard(page); } },
    onCancel() { if (current(page, task)) { page.photoTask = null; page.setData({ task: null }); guard(page); } }
  }));
  page.photoTask = task;
  return task.start(source);
}
function retry(page) {
  const task = page.photoTask; if (!task || page.disposed || task.committed) return;
  if (task.state === 'saveError') return task.save();
  if (task.state === 'sourceError') {
    const options = { date: task.date, memoryId: task.memoryId, targetBoardId: task.targetBoardId }, source = page.photoSource;
    return task.cancel().then(() => begin(page, source, options));
  }
  if (task.state === 'preview' || task.state === 'extractError') return task.process(false);
}
function finish(page, showNotice = true) {
  if (!page.photoTask || !page.photoTask.committed || page.disposed || !saveNote(page)) return false;
  page.photoTask = null; page.setData({ task: null }); guard(page);
  if (showNotice) platform.localNotice(page.store).catch(() => {});
  return true;
}
function openNote(page) {
  if (!page.photoTask || !page.photoTask.committed || !page.photoNoteId || page.data.placing || page.disposed) return;
  const draft = page.store.getMemoryDraft(page.photoNoteId);
  if (draft && !page.photoNoteDirty) { page.photoNoteDirty = true; page.setData({ photoNoteText: draft.text }); }
  page.setData({ photoNoteOpen: true }); guard(page);
}
function inputNote(page, e) {
  if (!page.photoTask || !page.photoTask.committed || !page.photoNoteId || page.data.placing || page.disposed) return;
  page.photoNoteDirty = true; page.setData({ photoNoteText: e.detail.value, photoNoteError: '' });
  const memory = page.store.get().memories[page.photoNoteId];
  if (memory) page.store.keepMemoryDraft(memory.id, { text: e.detail.value, category: Math.max(0, config.categories.indexOf(memory.category)) });
  guard(page);
}
function saveNote(page) {
  if (!page.photoNoteDirty) return true;
  try {
    const memory = page.store.get().memories[page.photoNoteId];
    if (!memory) throw new Error('这条记忆已被删除');
    page.store.edit(memory.id, page.data.photoNoteText, memory.category); page.store.clearMemoryDraft(memory.id);
    page.photoNoteDirty = false; page.setData({ photoNoteError: '' });
    if (page.refresh) page.refresh();
    guard(page); return true;
  } catch (error) { page.setData({ photoNoteOpen: true, photoNoteError: platform.message(error, '说明未保存，请重试') }); guard(page); return false; }
}
function cancel(page) {
  if (!page.photoTask || page.disposed) return;
  if (page.photoTask.committed) return finish(page);
  return page.photoTask.cancel();
}
function original(page) { if (page.photoTask && !page.disposed && page.photoTask.state === 'extractError') return page.photoTask.process(true); }
function dispose(page) {
  const task = page.photoTask;
  page.disposed = true; page.photoTask = null;
  if (page.data) page.data.task = null;
  if (task && !task.committed) return task.cancel();
}
module.exports = { begin, retry, cancel, original, finish, dispose, openNote, inputNote, saveNote };
