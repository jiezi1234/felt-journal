const dates = require('./date');
function dateAt(value, offset = 0) {
  const [y, m, d] = value.split('-').map(Number), day = new Date(y, m - 1, d + offset, 12);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}
function weekday(value) { const [y, m, d] = value.split('-').map(Number); return '日一二三四五六'[new Date(y, m - 1, d).getDay()]; }
function themes(state) {
  return Object.values(state.boards).filter(board => board.type === 'theme')
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)).map(board => {
      const latest = board.placements.reduce((best, placement) => !best || placement.createdAt >= best.createdAt ? placement : best, null);
      const memory = latest && state.memories[latest.memoryId];
      return { id: board.id, title: board.title, count: board.placements.length, color: board.color,
        latestPath: memory ? memory.subjectPath : '', latestId: memory ? memory.id : '', updatedAt: board.updatedAt };
    });
}
function defaultTheme(items, preferred) {
  if (items.some(item => item.id === preferred)) return preferred;
  return items.reduce((best, item) => !best || item.updatedAt > best.updatedAt ? item : best, null)?.id || '';
}
function recent(state, selected, today) {
  const end = dateAt(selected, 2) > today ? today : dateAt(selected, 2);
  return Array.from({ length: 5 }, (_, index) => {
    const date = dateAt(end, index - 4), board = state.boards[date];
    return { date, day: Number(date.slice(-2)), weekday: date === today ? '今天' : weekday(date), count: board ? board.placements.length : 0 };
  });
}
function month(state, year, monthNumber, today) {
  const previews = {};
  for (const board of Object.values(state.boards)) if (board.type !== 'theme') {
    previews[board.id] = board.placements.slice(-2).map(p => ({ id: p.memoryId, path: state.memories[p.memoryId].subjectPath }));
  }
  return dates.monthCells(year, monthNumber, today, previews);
}
module.exports = { dateAt, weekday, themes, defaultTheme, recent, month };
