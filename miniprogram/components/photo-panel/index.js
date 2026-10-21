const reveal = require('../../services/photo-reveal');
const stageLabels = {
  choosing: '等待选图…', persisting: '准备照片中…', uploading: '上传照片中…',
  extracting: '主体提取中…', saving: '保存记忆中…'
};
Component({
  properties: { task: Object, inline: Boolean, keyboard: Boolean, lifting: Boolean, adjusting: Boolean, adjustmentError: String, continueLabel: { type: String, value: '继续' }, noteOpen: Boolean, noteText: String, noteError: String, maxText: { type: Number, value: 1000 } },
  data: { showOriginal: false, preview: false, done: false, failed: false, analyzing: false, stageLabel: '', stageLines:[], resultLabel: '', displayImage: '', canCompare: false,
    originalSrc:'',subjectSrc:'',subjectStyle:'',subjectVisible:false,originalHidden:false,revealBusy:false,revealPhase:'original',revealError:'' },
  lifetimes: { detached() { this.dead = true; this.pendingContinue = null; reveal.clear(this); } },
  observers: {
    keyboard(visible) {
      if (visible || !this.pendingContinue) return;
      const task = this.pendingContinue; this.pendingContinue = null;
      wx.nextTick(() => { if (!this.dead && this.data.task === task) this.cancel(); });
    },
    task(task) {
      const state = task && task.state || '', original = task && task.original || '';
      const done = state === 'done', failed = ['extractError', 'saveError', 'sourceError'].includes(state);
      const subject = task && task.subject || '';
      const reset = original !== this._original || subject !== this._subject || done && this._state !== 'done';
      const showOriginal = reset ? false : this.data.showOriginal;
      this._original = original; this._subject = subject; this._state = state;
      const canCompare = !!(subject && original && task.kind !== 'original' && subject !== original);
      this.setData({
        showOriginal, preview: state === 'preview', done, failed,
        analyzing: !!task && !done && !failed && state !== 'preview',
        stageLabel: stageLabels[state] || '主体提取中…',
        stageLines:[{id:state,label:stageLabels[state] || '整理贴纸中…'}],
        resultLabel: task && task.category && task.category !== '未分类' ? `已保存 · ${task.category}` : task && task.kind === 'original' ? '照片已保存' : '主体已保存',
        displayImage: done && !showOriginal ? subject || original : canCompare && !showOriginal ? subject : original || subject, canCompare
      });
      reveal.update(this,task);
    }
  },
  methods: {
    originalLoaded(e) { reveal.loaded(this,'original',e); }, subjectLoaded(e) { reveal.loaded(this,'subject',e); },
    originalFailed(e) { reveal.failed(this,'original',e); }, subjectFailed(e) { reveal.failed(this,'subject',e); },
    retryPreview() { reveal.retry(this); },
    adjust() { if (this.data.done && !this.data.revealBusy && !this.data.adjusting && !this.data.lifting) this.triggerEvent('adjust'); },
    openNote() { this.triggerEvent('noteopen'); }, noteInput(e) { this.triggerEvent('noteinput', { value: e.detail.value }); },
    retry() { this.triggerEvent('retry'); }, original() { this.triggerEvent('original'); },
    cancel() {
      if (this.data.adjusting || this.data.lifting || this.data.revealBusy || this.data.revealError) return;
      if (!this.data.done) { this.triggerEvent('cancel'); return; }
      const task = this.data.task;
      // Inline keyboard layout hides the photo. Wait for its restored bounds
      // before measuring the source of the peel animation.
      if (this.data.inline && this.data.keyboard) {
        if (this.pendingContinue === task) return;
        this.pendingContinue = task;
        wx.hideKeyboard({ fail: () => { if (this.pendingContinue === task) this.pendingContinue = null; } });
        return;
      }
      if (this.continuing === task) return;
      this.continuing = task;
      const measure = () => this.createSelectorQuery().select('#task-image').boundingClientRect(rect => {
        if (this.continuing !== task) return;
        this.continuing = null;
        if (this.dead || this.data.task !== task) return;
        this.triggerEvent('cancel', { rect });
      }).exec();
      // The board receives the saved subject even when the user was comparing
      // the original. Measure that same subject's 92% container after reflow.
      if (this.data.showOriginal) this.setData({ showOriginal: false, displayImage: task.subject || task.original }, () => wx.nextTick(measure));
      else measure();
    },
    compare() {
      if (!this.data.canCompare || this.data.revealBusy || this.data.revealError) return;
      const showOriginal = !this.data.showOriginal;
      this.setData({ showOriginal, displayImage: showOriginal ? this.data.task.original : this.data.task.subject });
    },
    settings() { wx.openSetting({}); }, stop() {}
  }
});
