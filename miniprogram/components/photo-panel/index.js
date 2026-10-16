const stageLabels = {
  choosing: '等待选图…', persisting: '准备照片中…', uploading: '上传照片中…',
  extracting: '主体提取中…', saving: '保存记忆中…'
};
Component({
  properties: { task: Object, inline: Boolean, continueLabel: { type: String, value: '继续' } },
  data: { showOriginal: false, preview: false, done: false, failed: false, analyzing: false, stageLabel: '', resultLabel: '', displayImage: '', canCompare: false },
  observers: {
    task(task) {
      const state = task && task.state || '', original = task && task.original || '';
      const done = state === 'done', failed = ['extractError', 'saveError', 'sourceError'].includes(state);
      const reset = original !== this._original || done && this._state !== 'done';
      const showOriginal = reset ? false : this.data.showOriginal;
      this._original = original; this._state = state;
      const subject = task && task.subject || '';
      const canCompare = !!(subject && original && task.kind !== 'original' && subject !== original);
      this.setData({
        showOriginal, preview: state === 'preview', done, failed,
        analyzing: !!task && !done && !failed && state !== 'preview',
        stageLabel: stageLabels[state] || '主体提取中…',
        resultLabel: task && task.kind === 'original' ? '照片已保存' : '主体已保存',
        displayImage: canCompare && !showOriginal ? subject : original || subject, canCompare
      });
    }
  },
  methods: {
    retry() { this.triggerEvent('retry'); }, original() { this.triggerEvent('original'); }, cancel() { this.triggerEvent('cancel'); },
    compare() {
      if (!this.data.canCompare) return;
      const showOriginal = !this.data.showOriginal;
      this.setData({ showOriginal, displayImage: showOriginal ? this.data.task.original : this.data.task.subject });
    },
    settings() { wx.openSetting({}); }, stop() {}
  }
});
