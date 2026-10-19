const dates = require('./date');
const config = require('./config');
const geometry = require('./geometry');
const layers = require('./layers');
const felt = require('./felt');
const KEY = 'felt-journal:v1';
const DRAFT = 'felt-journal:drafts:v1';
const MEMORY_DRAFT = 'felt-journal:memory-drafts:v1';
const clone = value => JSON.parse(JSON.stringify(value));
// Keep the storage key so existing installations retain their data. Version 1
// is validated before a read-only upgrade; only a successful mutation writes v2.
const empty = () => ({ version: 2, revision: 0, boards: {}, memories: {}, operations: {}, garbage: [], localNoticeSeen: false });
const isThemeId = id => typeof id === 'string' && /^theme_[a-z0-9_]+$/.test(id);
const boardLabel = board => board.type === 'theme' ? board.title : dates.label(board.date);
const membership = board => board && board.membershipRevision || 0;
function touchMembers(board) { board.membershipRevision = membership(board) + 1; if (board.type === 'theme') board.updatedAt = Date.now(); }
function themeTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  assert(title && Array.from(title).length <= config.maxBoardTitle, `主题名称请填写 1–${config.maxBoardTitle} 个字`); return title;
}
function assert(condition, text) { if (!condition) throw new Error(text); }
function record(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validate(s) {
  assert(record(s) && [1, 2].includes(s.version) && Number.isInteger(s.revision) && s.revision >= 0 && record(s.boards) && record(s.memories) && record(s.operations) && Array.isArray(s.garbage) && s.garbage.every(p => typeof p === 'string') && typeof s.localNoticeSeen === 'boolean', '本地记录格式异常，请保留数据并重试');
  const seen = {};
  Object.keys(s.boards).forEach(id => {
    const b = s.boards[id], theme = b && b.type === 'theme', localSeen = new Set();
    assert(record(b) && b.id === id && (theme ? s.version === 2 && isThemeId(id) && dates.valid(b.date) && themeTitle(b.title) === b.title && Number.isFinite(b.createdAt) && Number.isFinite(b.updatedAt) : dates.valid(id) && b.date === id && (!b.type || b.type === 'daily')) && config.colors.some(c => c.value === b.color) && Array.isArray(b.placements) && b.placements.length <= config.maxItems, '板面数据异常');
    assert(b.membershipRevision === undefined || Number.isInteger(b.membershipRevision) && b.membershipRevision >= 0, '板面摆放版本异常');
    assert(config.textures.some(t => t.value === felt.textureOf(b)), '板面纹理数据异常');
    b.placements.forEach(p => {
      const m = s.memories[p.memoryId];
      assert(m && (theme || m.date === id) && (s.version === 2 || !seen[p.memoryId] && m.boardId === id) && !localSeen.has(p.memoryId) && p.id === `p_${p.memoryId}`, '记忆与摆放关系异常');
      assert(['x', 'y', 'width', 'height', 'angle', 'z', 'createdAt'].every(k => Number.isFinite(p[k])) && p.width > 0 && p.height > 0, '物件布局异常');
      const fixed = geometry.fit(p);
      assert(['x', 'y', 'width', 'height', 'angle'].every(k => Math.abs(p[k] - fixed[k]) < 0.01), '物件超出毡面');
      seen[p.memoryId] = true; localSeen.add(p.memoryId);
    });
  });
  Object.keys(s.memories).forEach(id => {
    const m = s.memories[id];
    assert(m.id === id && (s.version === 2 || seen[id]) && dates.valid(m.date) && m.date === m.boardId && typeof m.originalPath === 'string' && !!m.originalPath && typeof m.subjectPath === 'string' && !!m.subjectPath && m.originalPath !== m.subjectPath, '照片引用异常');
    assert(typeof m.text === 'string' && m.text.length <= config.maxText && config.categories.includes(m.category), '记忆内容异常');
    assert(m.categorySource === undefined || ['auto', 'manual', 'none'].includes(m.categorySource), '记忆分类来源异常');
  });
  return s;
}
function createStore(storage) {
  let state;
  function load() {
    const raw = storage.get(KEY);
    const parsed = raw === '' || raw === undefined || raw === null ? empty() : validate(typeof raw === 'string' ? JSON.parse(raw) : raw);
    state = clone(parsed); state.version = 2;
    return clone(state);
  }
  function get() { if (!state) load(); return clone(state); }
  function commit(change) {
    const next = get();
    change(next); next.revision++;
    validate(next);
    // One synchronous atomic storage write commits all model relationships.
    storage.set(KEY, JSON.stringify(next));
    state = next;
    return clone(next);
  }
  function board(id) {
    const current = get();
    if (isThemeId(id)) { assert(current.boards[id] && current.boards[id].type === 'theme', '主题板已被删除或不存在'); return felt.withTexture(current.boards[id]); }
    assert(dates.valid(id), '日期无效'); return felt.withTexture(current.boards[id] || { id, date: id, color: config.colors[0].value, placements: [] });
  }
  function canEdit(id) {
    if (isThemeId(id)) return !!get().boards[id];
    return dates.valid(id) && id <= dates.key() && (id === dates.key() || board(id).placements.length > 0 || Object.values(get().memories).some(m => m.date === id));
  }
  function add(taskId, date, photos, targetBoardId = date) {
    assert(dates.valid(date) && date <= dates.key(), '不能向未来或无效日期添加记忆');
    assert(targetBoardId === date || isThemeId(targetBoardId), '照片只能添加到原日期或主题板');
    const current = get();
    if (current.operations[taskId]) return current.operations[taskId];
    if (isThemeId(targetBoardId)) assert(!getDraft(targetBoardId), '目标板面存在未保存的布局，请先保存');
    // Authorization was captured at task start; a midnight rollover cannot retarget it.
    const id = `m_${taskId}`;
    commit(s => {
      const b = s.boards[targetBoardId] || (targetBoardId === date ? board(date) : null);
      assert(b, '主题板已被删除或不存在');
      assert(b.placements.length < config.maxItems, `每块板最多 ${config.maxItems} 件记忆`);
      const now = Date.now();
      s.memories[id] = Object.assign({ id, boardId: date, date, text: '', category: '未分类', createdAt: now, updatedAt: now }, photos);
      const z = Math.max(0, ...b.placements.map(p => p.z)) + 1;
      b.placements.push(geometry.create(id, photos.width, photos.height, z, now));
      touchMembers(b);
      s.boards[targetBoardId] = b; s.operations[taskId] = id;
    });
    return id;
  }
  function saveBoard(draft) {
    commit(s => {
      const original = s.boards[draft.id];
      assert(dates.valid(draft.id) && draft.id === draft.date && draft.date <= dates.key() || isThemeId(draft.id) && original && original.type === 'theme', '板面已不存在或日期无效');
      const ids = (original ? original.placements : []).map(p => p.memoryId).sort().join(',');
      assert(ids === draft.placements.map(p => p.memoryId).sort().join(',') && membership(original) === membership(draft), '记忆已变化，请重新打开板面');
      s.boards[draft.id] = felt.withTexture(Object.assign({}, original || draft, { color: draft.color, texture: felt.textureOf(draft), placements: clone(draft.placements) }));
    });
    clearDraft(draft.id);
  }
  function put(s, memoryId, boardId) {
    const m = s.memories[memoryId]; assert(m, '这条记忆已被删除');
    assert(m.date <= dates.key(), '不能使用未来日期的记忆');
    const b = s.boards[boardId] || (dates.valid(boardId) ? { id: boardId, date: boardId, color: config.colors[0].value, texture: config.defaultTexture, placements: [] } : null);
    assert(b && (b.type === 'theme' || boardId === m.date), '每日板只能放回当天的记忆，跨日收藏请使用主题板');
    if (b.placements.some(p => p.memoryId === memoryId)) return;
    assert(b.placements.length < config.maxItems, `每块板最多 ${config.maxItems} 件记忆`);
    const z = Math.max(0, ...b.placements.map(p => p.z)) + 1;
    b.placements.push(geometry.create(memoryId, m.width || 300, m.height || 300, z, Date.now())); touchMembers(b); s.boards[boardId] = b;
  }
  function place(memoryId, boardId) {
    const current = get(), target = current.boards[boardId];
    assert(current.memories[memoryId], '这条记忆已被删除');
    if (target && target.placements.some(p => p.memoryId === memoryId)) return memoryId;
    assert(!getDraft(boardId), '目标板面存在未保存的布局，请先打开板面保存');
    commit(s => put(s, memoryId, boardId)); clearDraft(boardId); return memoryId;
  }
  function unplace(memoryId, boardId) {
    const b = get().boards[boardId]; assert(b, '板面已不存在');
    if (!b.placements.some(p => p.memoryId === memoryId)) return;
    commit(s => { const target = s.boards[boardId]; target.placements = target.placements.filter(p => p.memoryId !== memoryId); touchMembers(target); });
    clearDraft(boardId);
  }
  function createTheme(taskId, title, memoryId) {
    const id = `theme_${taskId}`, name = themeTitle(title); assert(isThemeId(id), '主题板编号无效');
    if (get().boards[id]) return id;
    assert(Object.values(get().boards).filter(b => b.type === 'theme').length < config.maxThemes, `最多创建 ${config.maxThemes} 块主题板`);
    commit(s => {
      const now = Date.now(); s.boards[id] = { id, type: 'theme', title: name, date: dates.key(), color: config.colors[0].value, texture: config.defaultTexture, placements: [], membershipRevision: 0, createdAt: now, updatedAt: now };
      if (memoryId) put(s, memoryId, id);
    }); return id;
  }
  function renameTheme(id, title) {
    const name = themeTitle(title), b = board(id); assert(b.type === 'theme', '只能重命名主题板'); if (b.title === name) return;
    commit(s => { s.boards[id].title = name; s.boards[id].updatedAt = Date.now(); });
  }
  function deleteTheme(id) { assert(isThemeId(id), '只能删除主题板'); if (!get().boards[id]) return; commit(s => { delete s.boards[id]; }); clearDraft(id); }
  function boardsForMemory(id) { return Object.values(get().boards).filter(b => b.placements.some(p => p.memoryId === id)).map(b => ({ id: b.id, label: boardLabel(b) })); }
  function replace(taskId, id, photos) {
    if (get().operations[taskId]) return id;
    commit(s => {
      const m = s.memories[id]; assert(m, '这条记忆已被删除');
      s.garbage.push(m.originalPath, m.subjectPath);
      const fields = Object.assign({}, photos);
      // Existing manual choices (including legacy categories) survive replacement.
      if (m.categorySource === 'manual' || !m.categorySource && m.category !== '未分类') {
        delete fields.category; delete fields.categorySource;
      }
      // Placement is untouched, including its width, height and layer.
      Object.assign(m, fields, { subjectEdited: false, updatedAt: Date.now() }); s.operations[taskId] = id;
    });
    return id;
  }
  function editSubject(taskId, id, expected, image) {
    if (get().operations[taskId]) return id;
    commit(s => {
      const m = s.memories[id]; assert(m, '这条记忆已被删除');
      assert(m.originalPath === expected.originalPath && m.subjectPath === expected.subjectPath, '照片已变化，请返回详情重新打开图片调整');
      assert(image.subjectPath !== m.subjectPath && image.subjectPath !== m.originalPath && Number.isFinite(image.width) && image.width > 0 && Number.isFinite(image.height) && image.height > 0, '调整后的图片无效');
      s.garbage.push(m.subjectPath);
      Object.assign(m, { subjectPath: image.subjectPath, width: image.width, height: image.height, kind: image.kind, subjectEdited: true, updatedAt: Date.now() });
      s.operations[taskId] = id;
    });
    return id;
  }
  function edit(id, text, category) { commit(s => {
    const memory = s.memories[id]; assert(memory, '这条记忆已被删除');
    if (category !== memory.category) memory.categorySource = 'manual';
    Object.assign(memory, { text, category, updatedAt: Date.now() });
  }); }
  function remove(id) {
    const affected = [];
    commit(s => {
      const m = s.memories[id]; assert(m, '这条记忆已被删除');
      Object.values(s.boards).forEach(b => { if (b.placements.some(p => p.memoryId === id)) { affected.push(b.id); b.placements = b.placements.filter(p => p.memoryId !== id); touchMembers(b); } });
      s.garbage.push(m.originalPath, m.subjectPath); delete s.memories[id];
    });
    clearMemoryDraft(id); affected.forEach(clearDraft);
  }
  function view(date) {
    const s = get(), b = board(date);
    return Object.assign(b, { items: layers.ordered(b.placements).map(p => Object.assign({}, p, { memory: s.memories[p.memoryId] })) });
  }
  function drafts() { const raw = storage.get(DRAFT); return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {}; }
  function keepDraft(b) { try { const d = drafts(); d[b.id] = clone(b); storage.set(DRAFT, JSON.stringify(d)); return true; } catch (_) { return false; } }
  function clearDraft(date) { try { const d = drafts(); delete d[date]; storage.set(DRAFT, JSON.stringify(d)); } catch (_) { /* Primary snapshot already committed. */ } }
  function getDraft(date) { try { const draft = drafts()[date]; return draft ? felt.withTexture(draft) : undefined; } catch (_) { return undefined; } }
  function memoryDrafts() { const raw = storage.get(MEMORY_DRAFT); return raw ? JSON.parse(raw) : {}; }
  function keepMemoryDraft(id, draft) { try { const d = memoryDrafts(); d[id] = draft; storage.set(MEMORY_DRAFT, JSON.stringify(d)); return true; } catch (_) { return false; } }
  function getMemoryDraft(id) { try { return memoryDrafts()[id]; } catch (_) { return undefined; } }
  function clearMemoryDraft(id) { try { const d = memoryDrafts(); delete d[id]; storage.set(MEMORY_DRAFT, JSON.stringify(d)); } catch (_) {} }
  function referenced(path) { return Object.values(get().memories).some(m => m.originalPath === path || m.subjectPath === path); }
  return { load, get, commit, board, view, canEdit, add, replace, editSubject, edit, remove, place, unplace, createTheme, renameTheme, deleteTheme, boardsForMemory, saveBoard, keepDraft, clearDraft, getDraft, keepMemoryDraft, getMemoryDraft, clearMemoryDraft, referenced };
}
let singleton;
function getStore() {
  if (!singleton) singleton = createStore({ get: k => wx.getStorageSync(k), set: (k, v) => wx.setStorageSync(k, v) });
  return singleton;
}
module.exports = { KEY, DRAFT, validate, createStore, getStore, clone, isThemeId, boardLabel, membership };
