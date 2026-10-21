const { PhotoTask } = require('./photo-task');
const platform = require('./platform');
const config = require('../core/config');
const { SubjectEditTask } = require('./subject-edit');
function current(page, task) { return !page.disposed && page.photoTask === task; }
function guard(page) {
  const pending = page.photoTask && !page.photoTask.committed;
  platform.unloadGuard(!!pending || !!page.dirty || !!page.noteDirty || !!page.photoNoteDirty || !!page.data.photoAdjusting, pending ? '照片尚未保存，离开将取消处理。' : undefined);
  if (page.syncNavigation) page.syncNavigation();
}
function begin(page, source, options, previousResult) {
  if (page.disposed || page.photoTask) return;
  page.photoSource = source;
  page.photoNoteId = ''; page.photoNoteDirty = false;
  page.setData({ photoNoteOpen: false, photoNoteText: '', photoNoteError: '', photoAdjustmentError: '' });
  const task = new PhotoTask(Object.assign({}, options, {
    store: page.store, requireConfirmation: false,
    onState(snapshot) { if (current(page, task)) { page.setData({ task: snapshot }); guard(page); } },
    // Refresh the saved model now, while keeping the result visible until Continue.
    // A close/unload must never write an older board draft over the new memory.
    onDone(id) { task.savedId = id; if (current(page, task)) { page.photoNoteId = id; page.setData({ photoNoteText: page.store.get().memories[id].text }); page.photoDone(id); guard(page); } },
    onCancel() {
      if (!current(page, task)) return;
      page.photoTask = task.previousResult || null;
      if (page.photoTask) {
        page.photoNoteId = page.photoTask.savedId;
        const memory = page.store.get().memories[page.photoNoteId];
        page.setData({ photoNoteText: memory ? memory.text : '', photoNoteOpen: false });
        refreshResult(page, true);
      } else page.setData({ task: null });
      guard(page);
    }
  }));
  task.previousResult = previousResult;
  page.photoTask = task;
  return task.start(source);
}
function retry(page) {
  const task = page.photoTask; if (!task || page.disposed || task.committed) return;
  if (task.state === 'saveError') return task.save();
  if (task.state === 'sourceError') {
    const options = { date: task.date, memoryId: task.memoryId, targetBoardId: task.targetBoardId }, source = page.photoSource;
    const previous = task.previousResult; task.previousResult = null;
    return task.cancel().then(() => begin(page, source, options, previous));
  }
  if (task.state === 'preview' || task.state === 'extractError') return task.process(false);
}
function finish(page, showNotice = true) {
  if (!page.photoTask || !page.photoTask.committed || page.disposed || page.data.photoAdjusting || !saveNote(page)) return false;
  page.photoTask = null; page.setData({ task: null }); guard(page);
  if (showNotice) platform.localNotice(page.store).catch(() => {});
  return true;
}
function openNote(page) {
  if (!page.photoTask || !page.photoTask.committed || !page.photoNoteId || page.data.placing || page.data.photoAdjusting || page.disposed) return;
  const draft = page.store.getMemoryDraft(page.photoNoteId);
  if (draft && !page.photoNoteDirty) { page.photoNoteDirty = true; page.setData({ photoNoteText: draft.text }); }
  page.setData({ photoNoteOpen: true }); guard(page);
}
function inputNote(page, e) {
  if (!page.photoTask || !page.photoTask.committed || !page.photoNoteId || page.data.placing || page.data.photoAdjusting || page.disposed) return;
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
  if (!page.photoTask || page.disposed || page.data.photoAdjusting) return;
  if (page.photoTask.committed) return finish(page);
  return page.photoTask.cancel();
}
function original(page) { if (page.photoTask && !page.disposed && page.photoTask.state === 'extractError') return page.photoTask.process(true); }
function refreshResult(page, force = false) {
  const task = page.photoTask;
  if (!task || !task.committed || page.disposed) return;
  const memory = page.store.get().memories[task.savedId || page.photoNoteId];
  if (!memory || !force && memory.subjectPath === task.subjectPath && memory.originalPath === task.originalPath) return;
  Object.assign(task, { originalPath: memory.originalPath, subjectPath: memory.subjectPath, kind: memory.kind, savedCategory: memory.category, alignment:null });
  task.stage('done');
}
async function adjustResult(page) {
  const task = page.photoTask;
  if (!task || !task.committed || task.state !== 'done' || page.disposed || page.data.photoAdjusting || page.data.placing || page.data.lifting || !saveNote(page)) return;
  page.setData({ photoAdjusting: true, photoAdjustmentError: '' }); guard(page);
  try {
    const choice = await platform.call('showActionSheet', { itemList: ['裁剪 / 旋转', '保留原图（含背景）', '换张照片'] });
    if (!current(page, task)) return;
    const id = task.savedId, memory = page.store.get().memories[id];
    if (!memory) throw new Error('这条记忆已被删除');
    if (choice.tapIndex === 0) {
      await platform.call('navigateTo', { url: `/pages/photo-edit/index?id=${encodeURIComponent(id)}&from=result` });
    } else if (choice.tapIndex === 1) {
      const editTask = page.resultEditTask = new SubjectEditTask(page.store, id, memory);
      await editTask.save(async () => memory.originalPath, 'original');
      if (current(page, task)) { refreshResult(page); page.photoDone(id); }
    } else if (choice.tapIndex === 2) {
      const source = await platform.call('showActionSheet', { itemList: ['从相册重选', '重新拍照'] });
      if (!current(page, task) || ![0, 1].includes(source.tapIndex)) return;
      page.photoTask = null; page.setData({ photoAdjusting: false });
      await begin(page, source.tapIndex === 0 ? 'album' : 'camera', { date: task.date, memoryId: id, targetBoardId: task.targetBoardId }, task);
    }
  } catch (error) {
    if (current(page, task) && !/cancel/i.test(error.errMsg || error.message || '')) page.setData({ photoAdjustmentError: platform.message(error, '调整未完成，原结果已保留，请重试') });
  } finally {
    if (current(page, task)) { page.resultEditTask = null; page.setData({ photoAdjusting: false }); guard(page); }
  }
}
function dispose(page) {
  const task = page.photoTask;
  page.disposed = true; page.photoTask = null;
  if (page.data) page.data.task = null;
  if (page.resultEditTask) page.resultEditTask.cancel();
  if (task && !task.committed) return task.cancel();
}
module.exports = { begin, retry, cancel, original, finish, dispose, openNote, inputNote, saveNote, refreshResult, adjustResult };
