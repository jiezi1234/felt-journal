const platform = require('./platform');
const { newId } = require('./photo-task');
class SubjectEditTask {
  constructor(store, memoryId, expected) {
    this.store = store; this.memoryId = memoryId; this.expected = expected; this.id = newId(); this.owned = [];
  }
  check() { if (this.cancelled) throw new Error('处理已取消'); }
  async save(render, kind) {
    if (this.busy || this.cancelled || this.committed) return false;
    this.busy = true;
    try {
      const temporary = await render(); this.check();
      const subjectPath = await platform.persist(temporary, `${this.id}_subject`); this.owned.push(subjectPath); this.check();
      const info = await platform.call('getImageInfo', { src: subjectPath }); this.check();
      this.store.editSubject(this.id, this.memoryId, this.expected, { subjectPath, width: info.width, height: info.height, kind });
      this.committed = true; platform.releaseFiles(this.owned); this.owned = [];
      platform.collect(this.store).catch(() => {}); return true;
    } catch (error) {
      await this.cleanup(); if (!this.cancelled) throw error; return false;
    } finally { this.busy = false; }
  }
  async cleanup() {
    const files = this.owned.slice(); this.owned = [];
    for (const path of files) if (!this.store.referenced(path)) await platform.unlink(path);
    platform.releaseFiles(files);
  }
  async cancel() { this.cancelled = true; await this.cleanup(); }
}
module.exports = { SubjectEditTask };
