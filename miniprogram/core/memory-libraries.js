const config = require('./config');
const ALL = 'all';
function title(value) {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || Array.from(name).length > config.maxLibraryTitle) throw new Error(`记忆库名称请填写 1–${config.maxLibraryTitle} 个字`);
  return name;
}
function validId(id) { return typeof id === 'string' && /^library_[a-z0-9_]+$/.test(id); }
function validate(state) {
  // Optional on older snapshots. Older clients may delete a photo without
  // removing its library reference; projections omit these stale references.
  if (state.libraries === undefined) return;
  const libraries = state.libraries;
  if (!libraries || typeof libraries !== 'object' || Array.isArray(libraries) || Object.keys(libraries).length > config.maxLibraries) throw new Error('记忆库数据异常');
  Object.keys(libraries).forEach(id => {
    const item = libraries[id];
    if (!validId(id) || !item || item.id !== id || title(item.title) !== item.title || !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt) || !Array.isArray(item.memoryIds) || item.memoryIds.some(value => typeof value !== 'string' || !value) || new Set(item.memoryIds).size !== item.memoryIds.length) throw new Error('记忆库数据异常');
  });
}
function members(state, id) {
  const library = (state.libraries || {})[id];
  const ids = id === ALL ? Object.keys(state.memories) : library ? library.memoryIds : [];
  return ids.map(key => state.memories[key]).filter(Boolean)
    .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}
function list(state) {
  return Object.values(state.libraries || {}).sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)).map(item => {
    const objects = members(state, item.id);
    return { id: item.id, title: item.title, count: objects.length, images: objects.slice(0, 3).map(m => ({ id: m.id, path: m.subjectPath })) };
  });
}
function forMemory(state, id) { return list(state).filter(item => state.libraries[item.id].memoryIds.includes(id)); }
module.exports = { ALL, title, validId, validate, members, list, forMemory };
