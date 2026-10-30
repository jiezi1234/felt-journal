const dates = require('./date');
const KEY = 'felt-journal:recall:v1';
const INTERVAL = 45000;
function age(date, today) {
  const utc = value => { const [y, m, d] = value.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(today) - utc(date)) / 86400000);
}
function preferences(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const ids = list => Array.isArray(list) ? [...new Set(list.filter(id => typeof id === 'string'))] : [];
    return { hidden: ids(value && value.hidden), recent: ids(value && value.recent).slice(0, 100) };
  } catch (_) { return { hidden: [], recent: [] }; }
}
function candidates(memories, prefs, today, failed = {}) {
  const hidden = new Set(prefs.hidden);
  return Object.values(memories).filter(m => dates.valid(m.date) && m.date < today && m.subjectPath && !hidden.has(m.id) && failed[m.id] !== m.subjectPath);
}
function choose(memories, prefs, today, currentId, failed, random = Math.random) {
  let pool = candidates(memories, prefs, today, failed);
  if (pool.length > 1) pool = pool.filter(m => m.id !== currentId);
  if (!pool.length) return null;
  // Unseen items first; otherwise least recently shown. Prefer older memories
  // within that group, so a small old collection cannot starve newer records.
  const unseen = pool.filter(m => !prefs.recent.includes(m.id));
  if (unseen.length) pool = unseen;
  else {
    const oldest = Math.max(...pool.map(m => prefs.recent.indexOf(m.id)));
    pool = pool.filter(m => prefs.recent.indexOf(m.id) === oldest);
  }
  const older = pool.filter(m => age(m.date, today) >= 7);
  if (older.length) pool = older;
  return pool[Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length))];
}
function shown(prefs, id) { return { ...prefs, recent: [id, ...prefs.recent.filter(value => value !== id)].slice(0, 100) }; }
function describe(memory, today) {
  return memory ? { ...memory, path: memory.subjectPath, age: `${age(memory.date, today)} 天前`, dateLabel: dates.label(memory.date) } : null;
}
module.exports = { KEY, INTERVAL, age, preferences, candidates, choose, shown, describe };
