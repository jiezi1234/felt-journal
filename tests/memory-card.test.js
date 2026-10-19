const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const platform = require('../miniprogram/services/platform');
const dates = require('../miniprogram/core/date');
let definition;
global.Component = value => { definition = value; }; require('../miniprogram/components/memory-card/index'); delete global.Component;
function fixture(t) {
  const original = platform.unloadGuard; t.after(() => { platform.unloadGuard = original; });
  const disk = {}, guards = [], events = []; let fail = false;
  platform.unloadGuard = value => guards.push(value);
  const store = createStore({ get: key => disk[key], set(key, value) { if (fail && key === KEY) throw new Error('disk full'); disk[key] = value; } });
  const id = store.add('card', dates.key(), { originalPath: '/original.jpg', subjectPath: '/subject.png', width: 400, height: 300, category: '自然', categorySource: 'auto' });
  store.createTheme('card_theme', '春天', id);
  function mount() {
    const card = { ...definition.methods, store, data: { ...clone(definition.data), memoryId: id },
      setData(value) { Object.assign(this.data, value); }, triggerEvent(name, detail) { events.push({ name, detail }); } };
    card.refresh(); return card;
  }
  return { store, id, disk, guards, events, mount, fail(value) { fail = value; } };
}
const input = value => ({ detail: { value } });

test('opening and flipping an uncaptioned image writes nothing; text can be added, edited and cleared', t => {
  const f = fixture(t), raw = f.disk[KEY], c = f.mount();
  assert.equal(c.data.flipped, false); c.flip(); assert.equal(c.data.flipped, true);
  assert.equal(c.data.memory.text, ''); c.flip(); assert.equal(f.disk[KEY], raw);
  const boards = clone(f.store.get().boards);
  c.edit(); c.flip(); assert.equal(c.data.flipped, true, 'typing must not flip the card');
  c.input(input('窗边的绿意\n今天也很美好')); assert.equal(c.save(), true);
  assert.equal(c.data.editing, false); assert.equal(f.mount().data.memory.text, '窗边的绿意\n今天也很美好');
  c.edit(); c.input(input('修改后的说明')); c.save(); assert.equal(f.store.get().memories[f.id].text, '修改后的说明');
  assert.equal(f.store.get().memories[f.id].categorySource, 'auto'); assert.deepEqual(f.store.get().boards, boards);
  c.edit(); c.input(input('')); c.save(); assert.equal(f.mount().data.memory.text, ''); assert.equal(f.store.getMemoryDraft(f.id), undefined);
});

test('save failure keeps a recoverable draft and blocks close/options until retry succeeds', t => {
  const f = fixture(t), c = f.mount(); c.edit(); c.input(input('保存失败也不能丢失'));
  f.fail(true); assert.equal(c.save(), false); c.close(); c.details();
  assert.equal(c.data.editing, true); assert.ok(c.data.error); assert.equal(f.store.get().memories[f.id].text, '');
  assert.equal(f.events.length, 0); assert.equal(f.store.getMemoryDraft(f.id).text, '保存失败也不能丢失');
  const restored = f.mount(); assert.equal(restored.data.flipped, true); assert.equal(restored.data.editing, true);
  assert.equal(restored.data.text, '保存失败也不能丢失'); assert.equal(f.guards.at(-1), true);
  f.fail(false); restored.close(); assert.equal(f.events.at(-1).name, 'close'); assert.equal(f.store.getMemoryDraft(f.id), undefined);
  assert.equal(f.store.get().memories[f.id].text, '保存失败也不能丢失'); assert.equal(f.guards.at(-1), false);
});

test('cancel discards only the current text draft and external edits refresh; deleted records can close', t => {
  const f = fixture(t), c = f.mount(); f.store.edit(f.id, '已保存', '自然'); c.refresh();
  c.edit(); c.input(input('不保留')); c.cancelEdit(); assert.equal(c.data.text, '已保存'); assert.equal(f.store.getMemoryDraft(f.id), undefined);
  c.edit(); c.input(input('查看选项前保存')); c.details(); assert.equal(f.events.at(-1).name, 'details'); assert.equal(f.store.get().memories[f.id].text, '查看选项前保存');
  c.input(input('另一个草稿')); f.store.remove(f.id); c.refresh(); assert.equal(c.data.memory, null);
  c.close(); assert.equal(f.events.at(-1).name, 'close');
});
