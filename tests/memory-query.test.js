const test = require('node:test');
const assert = require('node:assert/strict');
const search = require('../miniprogram/core/memory-query');
const today = '2026-10-14';
function memory(id, date, category, createdAt = 1, text = '') { return { id, date, category, createdAt, text, subjectPath: `/${id}.png`, originalPath: `/${id}.jpg` }; }
function state() { return { memories: {
  old: memory('old', '2024-02-29', '饮食'), first: memory('first', today, '饮食', 2), second: memory('second', today, '自然', 1),
  unfiled: memory('unfiled', '2026-09-01', '未分类'), future: memory('future', '2026-10-15', '饮食')
} }; }
const ids = result => result.groups.flatMap(group => group.items.map(item => item.id));
test('category and month intersect; counts describe the period, exclude future and include unfiled', () => {
  const all = search.query(state(), {}, today); assert.equal(all.total, 4); assert.deepEqual(ids(all), ['first', 'second', 'unfiled', 'old']);
  const food = search.query(state(), { category: '饮食' }, today); assert.equal(food.total, 2); assert.equal(food.categories.find(c => c.value === '自然').count, 1);
  assert.equal(food.categories.find(c => c.value === '').count, 4); assert.equal(food.categories.find(c => c.value === '未分类').count, 1);
  const month = search.query(state(), { category: '饮食', month: '2026-10' }, today); assert.deepEqual(ids(month), ['first']); assert.equal(month.scopeTotal, 2);
  assert.deepEqual(ids(search.query(state(), { month: '2024-02' }, today)), ['old']); assert.equal(search.query(state(), { month: '2024-01' }, today).total, 0);
  assert.deepEqual(ids(search.query(state(), { category: '未分类' }, today)), ['unfiled']);
});
test('pagination is stable across ties, clamps after deletion and does not mutate records', () => {
  const data = { memories: {} };
  for (let i = 40; i >= 0; i--) { const id = `m_${String(i).padStart(2, '0')}`; data.memories[id] = memory(id, '2026-09-01', '饮食', 1); }
  const raw = JSON.stringify(data), first = search.query(data, { page: 1 }, today), second = search.query(data, { page: 2 }, today), third = search.query(data, { page: 3 }, today);
  assert.equal(first.total, 41); assert.equal(first.pageCount, 3); assert.equal(ids(first).length, 20); assert.equal(ids(second).length, 20); assert.deepEqual(ids(third), ['m_40']);
  assert.equal(new Set([...ids(first), ...ids(second), ...ids(third)]).size, 41); assert.equal(JSON.stringify(data), raw);
  delete data.memories.m_40; assert.equal(search.query(data, { page: 3 }, today).page, 2);
  assert.equal(search.query({ memories: {} }, { page: 5 }, today).page, 1);
  assert.equal(search.query(data, { page: -1 }, today).page, 1); assert.equal(search.query(data, { page: NaN }, today).page, 1);
});
test('invalid route filters fall back safely; summaries are bounded and do not expose originals', () => {
  for (const month of ['2026-13', '2026-1', '2027-01', '../', null]) assert.equal(search.normalize({ category: 'invalid', month }, today).month, '');
  assert.equal(search.normalize({ category: 'invalid' }, today).category, '');
  const m = memory('long', today, '心情', 1, `  ${'🌸'.repeat(85)}\n  记录 `), result = search.query({ memories: { long: m } }, {}, today).groups[0].items[0];
  assert.equal(Array.from(result.excerpt).length, 81); assert.ok(result.excerpt.endsWith('…')); assert.equal(result.originalPath, undefined); assert.equal(result.text, undefined);
  m.text = ' \n\t'; assert.equal(search.query({ memories: { long: m } }, {}, today).groups[0].items[0].excerpt, '');
});
