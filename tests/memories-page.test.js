const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const platform = require('../miniprogram/services/platform');
let definition;
global.Page = page => { definition = page; }; require('../miniprogram/pages/memories/index'); delete global.Page;
const event = dataset => ({ currentTarget: { dataset } });
function fixture(t, count = 25) {
  const original = { ...platform }; t.after(() => Object.assign(platform, original));
  platform.call = async () => ({}); platform.toast = () => {}; platform.back = () => {};
  const disk = {}, storage = { get: key => disk[key], set: (key, value) => { disk[key] = value; } }, store = createStore(storage), ids = [];
  for (let i = 0; i < count; i++) { const id = store.add(`item_${i}`, '2024-02-29', { originalPath: `/original-${i}.png`, subjectPath: `/subject-${i}.png`, width: 400, height: 300, kind: 'extracted' }); store.edit(id, `记忆 ${i}`, '饮食'); ids.push(id); }
  const page = Object.assign({}, definition, { store, missingPaths: new Set(), data: { ...clone(definition.data), month: dates.key().slice(0, 7) }, setData(value) { Object.assign(this.data, value); } });
  page.refresh(); return { page, store, disk, ids };
}
test('filters, time range and pagination only read storage and keep conditions on return', t => {
  const { page: p, store, disk } = fixture(t), raw = disk[KEY], saved = store.get();
  p.category(event({ category: '饮食' })); p.next(); assert.equal(p.data.page, 2); assert.equal(p.data.groups[0].items.length, 4);
  p.onShow(); assert.equal(p.data.page, 2); assert.equal(p.data.category, '饮食'); assert.equal(p.data.scope, 'all');
  p.month({ detail: { value: '2024-02' } }); assert.equal(p.data.scope, 'month'); assert.equal(p.data.page, 1); assert.equal(p.data.total, 25);
  p.month({ detail: { value: '2024-01' } }); assert.equal(p.data.total, 0); assert.equal(p.data.month, '2024-01');
  p.allTime(); assert.equal(p.data.total, 25); assert.equal(p.data.category, '饮食');
  assert.equal(disk[KEY], raw); assert.deepEqual(store.get(), saved);
});
test('detail category edits and deletions refresh counts/results and clamp an empty last page', t => {
  const { page: p, store, ids } = fixture(t, 5); p.category(event({ category: '饮食' })); p.next(); assert.equal(p.data.page, 2);
  const lastId = p.data.groups[0].items[0].id; store.edit(lastId, '转到自然分类', '自然'); p.onShow();
  assert.equal(p.data.category, '饮食'); assert.equal(p.data.total, 4); assert.equal(p.data.page, 1); assert.equal(p.data.categories.find(c => c.value === '自然').count, 1);
  p.category(event({ category: '自然' })); assert.equal(p.data.total, 1); store.remove(lastId); p.onShow();
  assert.equal(p.data.total, 0); assert.equal(p.data.category, '自然'); assert.equal(p.data.hasNext, false); assert.match(p.data.emptyTitle, /自然/);
  p.clearCategory(); assert.equal(p.data.total, ids.length - 1);
});
test('missing image marks only its current path; replacement clears that state on return', t => {
  const { page: p, store } = fixture(t, 1), item = p.data.groups[0].items[0];
  p.imageError(event({ id: item.id, path: '/stale.png' })); assert.equal(p.data.groups[0].items[0].missing, false);
  p.imageError(event({ id: item.id, path: item.path })); p.refresh(); assert.equal(p.data.groups[0].items[0].missing, true);
  store.replace('replace', item.id, { originalPath: '/new-original.png', subjectPath: '/new-subject.png', width: 400, height: 300, kind: 'extracted' }); p.onShow();
  assert.equal(p.data.groups[0].items[0].missing, false); assert.equal(p.data.groups[0].items[0].path, '/new-subject.png');
  p.imageError(event({ id: item.id, path: item.path })); assert.equal(p.data.groups[0].items[0].missing, false);
});
test('bad storage shows error without overwriting data; repair and retry retains filters', t => {
  const { page: p, disk } = fixture(t, 1); p.category(event({ category: '饮食' })); const raw = disk[KEY];
  disk[KEY] = '{invalid'; p.refresh(); assert.ok(p.data.error); assert.equal(p.data.groups.length, 0); assert.equal(p.data.hasNext, false); assert.equal(disk[KEY], '{invalid');
  disk[KEY] = raw; p.refresh(); assert.equal(p.data.error, ''); assert.equal(p.data.category, '饮食'); assert.equal(p.data.total, 1);
});
test('memories open and close in place; board navigation retains context and serializes requests', async t => {
  const { page: p } = fixture(t, 1), item = p.data.groups[0].items[0]; let resolve, request, calls = 0;
  platform.call = (name, options) => { calls++; request = { name, ...options }; return new Promise(done => { resolve = done; }); };
  p.open(event({ id: item.id })); p.open(event({ id: item.id })); assert.equal(calls, 0); assert.equal(p.data.memoryCardId, item.id);
  p.closeMemoryCard(); assert.equal(p.data.memoryCardId, ''); assert.equal(calls, 0);
  const opened = p.board(event({ date: '2024-02-29' })); p.board(event({ date: '2024-02-29' }));
  assert.equal(calls, 1); assert.equal(p.data.opening, true); assert.equal(request.url, '/pages/board/index?date=2024-02-29');
  resolve({}); await opened; assert.equal(p.data.opening, false);
  platform.call = async (name, options) => { request = { name, ...options }; }; await p.board(event({ date: '2024-02-29' }));
  assert.equal(request.url, '/pages/board/index?date=2024-02-29');
  const before = request; p.board(event({ date: '2024-01-01' })); p.open(event({ id: 'missing' })); assert.strictEqual(request, before);
});
test('empty categories, month switching and invalid input keep consistent selection and reset page', t => {
  const { page: p } = fixture(t); p.next(); p.category(event({ category: '出行' })); assert.equal(p.data.total, 0); assert.equal(p.data.page, 1);
  const before = clone(p.data); p.category(event({ category: 'INVALID' })); p.month({ detail: { value: '2099-01' } }); assert.deepEqual(p.data, before);
  p.clearCategory(); assert.equal(p.data.total, 25); p.scope(event({ scope: 'month' })); assert.equal(p.data.total, 0);
  p.month({ detail: { value: '2024-02' } }); assert.equal(p.data.total, 25); p.next(); assert.equal(p.data.page, 2);
  p.category(event({ category: '未分类' })); assert.equal(p.data.page, 1); assert.equal(p.data.total, 0);
});

test('small-window resize keeps the current result in view and restores four-item pages', t => {
  const { page: p, disk } = fixture(t, 9), raw = disk[KEY];
  const originalWx = global.wx; t.after(() => { global.wx = originalWx; });
  p.next(); const first = p.data.groups[0].items[0].id;
  global.wx = { getWindowInfo: () => ({ windowHeight: 504 }) }; p.onResize();
  assert.equal(p.data.pageSize, 2); assert.equal(p.data.page, 3); assert.equal(p.data.groups[0].items[0].id, first);
  global.wx.getWindowInfo = () => ({ windowHeight: 753 }); p.onResize();
  assert.equal(p.data.pageSize, 4); assert.equal(p.data.page, 2); assert.equal(p.data.groups[0].items[0].id, first); assert.equal(disk[KEY], raw);
});
