const platform = require('./platform');
const service = require('./extraction');
let sequence = 0;
function newId() { return `${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
class PhotoTask {
  constructor(options) {
    Object.assign(this, options); this.id = newId(); this.cancelled = false; this.owned = []; this.busy = false; this.committed = false;
  }
  stage(state, error) { if (!this.cancelled) this.onState({ state, error: error || '', permission: /权限/.test(error || ''), original: this.originalPath || '', subject: this.subjectPath || '' }); }
  check() { if (this.cancelled) throw new Error('处理已取消'); }
  async own(path, role) {
    const saved = await platform.persist(path, `${this.id}_${role}`);
    this.owned.push(saved); this.check(); return saved;
  }
  async start(source) {
    if (this.busy) return; this.busy = true;
    try {
      this.stage('choosing');
      this.photo = await platform.choose(source); this.check();
      this.stage('persisting');
      this.originalPath = await this.own(this.photo.path, 'original');
    } catch (e) {
      this.busy = false;
      if (/cancel/i.test(e.errMsg || '') || this.cancelled) { await this.cancel(); return; }
      this.stage('sourceError', platform.message(e, '照片读取或保存失败，请重选照片')); return;
    }
    this.busy = false; return this.process(false);
  }
  async process(useOriginal) {
    if (this.busy || this.cancelled || this.committed) return;
    this.busy = true;
    try {
      this.check();
      if (!this.originalPath) throw new Error('请重新选择照片');
      const result = useOriginal ? this.originalPath : await service.extract(this.originalPath, this, state => this.stage(state));
      this.check();
      this.result = result; this.kind = useOriginal ? 'original' : 'extracted';
    } catch (e) {
      this.busy = false;
      if (this.cancelled) { await this.cleanup(); return; }
      this.stage('extractError', platform.message(e, '主体提取失败，请重试或使用原图')); return;
    }
    this.busy = false; return this.save();
  }
  async save() {
    if (this.busy || this.cancelled || this.committed) return;
    this.busy = true;
    try {
      this.stage('saving'); this.check();
      if (!this.subjectPath) this.subjectPath = await this.own(this.result, 'subject');
      const info = await platform.call('getImageInfo', { src: this.subjectPath }); this.check();
      const photos = { originalPath: this.originalPath, subjectPath: this.subjectPath, width: info.width, height: info.height, kind: this.kind };
      // Synchronous commit makes cancellation and duplicate callbacks unambiguous.
      const id = this.memoryId ? this.store.replace(this.id, this.memoryId, photos) : this.store.add(this.id, this.date, photos);
      this.committed = true; platform.releaseFiles(this.owned); this.owned = []; this.stage('done'); this.onDone(id);
      platform.collect(this.store).catch(() => {});
    } catch (e) {
      if (this.cancelled) await this.cleanup();
      else this.stage('saveError', platform.message(e, '照片保存失败，结果已保留，请重试保存'));
    } finally { this.busy = false; }
  }
  async cleanup() {
    const files = this.owned.slice(); this.owned = [];
    for (const path of files) if (!this.store.referenced(path)) await platform.unlink(path);
    platform.releaseFiles(files);
  }
  async cancel() {
    if (this.committed) return;
    this.cancelled = true; if (this.abort) this.abort();
    await this.cleanup(); this.onCancel();
  }
}
module.exports = { PhotoTask, newId };
