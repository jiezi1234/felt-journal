const config = require('./config');
const dates = require('./date');
const PAGE_SIZE = 20;
const categoryNames = [''].concat(config.categories.filter(name => name !== '未分类'), ['未分类']);
function validMonth(month, today) { return typeof month === 'string' && /^\d{4}-\d{2}$/.test(month) && dates.valid(`${month}-01`) && month <= today.slice(0, 7); }
function normalize(options, today) {
  return { category: categoryNames.includes(options.category) ? options.category : '', month: validMonth(options.month, today) ? options.month : '' };
}
function compare(a, b) { return b.date.localeCompare(a.date) || b.createdAt - a.createdAt || a.id.localeCompare(b.id); }
function excerpt(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim(), characters = Array.from(clean);
  return clean ? characters.slice(0, 80).join('') + (characters.length > 80 ? '…' : '') : '';
}
// This query is read-only. Category selection never filters or reorders a board.
function query(state, options = {}, today = dates.key()) {
  const filter = normalize(options, today), counts = {};
  config.categories.forEach(name => { counts[name] = 0; });
  const day = dates.valid(options.date) && options.date <= today ? options.date : '';
  const scoped = Object.values(state.memories).filter(m => m.date <= today && (!day || m.date === day) && (!filter.month || m.date.startsWith(`${filter.month}-`)));
  scoped.forEach(m => { counts[m.category]++; });
  const matching = scoped.filter(m => !filter.category || m.category === filter.category).sort(compare);
  const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? Math.min(PAGE_SIZE, options.pageSize) : PAGE_SIZE;
  const total = matching.length, pageCount = Math.max(1, Math.ceil(total / pageSize));
  const requested = Number.isInteger(options.page) ? options.page : 1, page = Math.max(1, Math.min(pageCount, requested));
  const groups = [];
  matching.slice((page - 1) * pageSize, page * pageSize).forEach(m => {
    let group = groups[groups.length - 1];
    if (!group || group.date !== m.date) { group = { date: m.date, label: dates.label(m.date), items: [] }; groups.push(group); }
    group.items.push({ id: m.id, date: m.date, category: m.category, path: m.subjectPath, excerpt: excerpt(m.text), missing: false });
  });
  return { ...filter, categories: categoryNames.map(name => ({ value: name, name: name || '全部', count: name ? counts[name] : scoped.length })), groups,
    total, scopeTotal: scoped.length, page, pageCount, pageSize, hasPrevious: page > 1, hasNext: page < pageCount };
}
module.exports = { query, normalize, validMonth, PAGE_SIZE };
