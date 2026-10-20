const stageLabels = {
  choosing: '等待选图…', persisting: '准备照片中…', uploading: '上传照片中…',
  extracting: '主体提取中…', saving: '保存记忆中…'
};
Component({
  properties: { task: Object, inline: Boolean, lifting: Boolean, adjusting: Boolean, adjustmentError: String, continueLabel: { type: String, value: '继续' }, noteOpen: Boolean, noteText: String, noteError: String, maxText: { type: Number, value: 1000 } },
  data: { showOriginal: false, preview: false, done: false, failed: false, analyzing: false, stageLabel: '', resultLabel: '', displayImage: '', canCompare: false },
  lifetimes: { detached() { this.dead = true; } },
  observers: {
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
        resultLabel: task && task.category && task.category !== '未分类' ? `已保存 · ${task.category}` : task && task.kind === 'original' ? '照片已保存' : '主体已保存',
        displayImage: done && !showOriginal ? subject || original : canCompare && !showOriginal ? subject : original || subject, canCompare
      });
    }
  },
  methods: {
    adjust() { if (this.data.done && !this.data.adjusting && !this.data.lifting) this.triggerEvent('adjust'); },
    openNote() { this.triggerEvent('noteopen'); }, noteInput(e) { this.triggerEvent('noteinput', { value: e.detail.value }); },
    retry() { this.triggerEvent('retry'); }, original() { this.triggerEvent('original'); },
    cancel() {
      if (this.data.adjusting || this.data.lifting) return;
      if (!this.data.done) { this.triggerEvent('cancel'); return; }
      const task = this.data.task;
      if (this.continuing === task) return;
      this.continuing = task;
      this.createSelectorQuery().select('#task-image').boundingClientRect(rect => {
        if (this.continuing !== task) return;
        this.continuing = null;
        if (this.dead || this.data.task !== task) return;
        this.triggerEvent('cancel', { rect });
      }).exec();
    },
    compare() {
      if (!this.data.canCompare) return;
      const showOriginal = !this.data.showOriginal;
      this.setData({ showOriginal, displayImage: showOriginal ? this.data.task.original : this.data.task.subject });
    },
    settings() { wx.openSetting({}); }, stop() {}
  }
});
