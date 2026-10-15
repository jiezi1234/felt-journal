const pad = n => String(n).padStart(2, '0');
function key(d) { d = d || new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function valid(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return key(date) === value;
}
function label(value) { const [y, m, d] = value.split('-'); return `${y}年${Number(m)}月${Number(d)}日`; }
function shiftMonth(y, m, offset) { const d = new Date(y, m - 1 + offset, 1); return { year: d.getFullYear(), month: d.getMonth() + 1 }; }
function monthCells(year, month, today, previews) {
  const start = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const cells = Array.from({ length: start }, (_, i) => ({ id: `blank-${i}`, blank: true }));
  for (let day = 1; day <= days; day++) {
    const date = `${year}-${pad(month)}-${pad(day)}`;
    cells.push({ id: date, date, day, today: date === today, future: date > today, images: (previews[date] || []).slice(0, 2) });
  }
  while (cells.length % 7) cells.push({ id: `blank-${cells.length}`, blank: true });
  return cells;
}
module.exports = { key, valid, label, shiftMonth, monthCells };
