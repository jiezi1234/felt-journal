const clone = value => JSON.parse(JSON.stringify(value));
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function sameMembers(a, b) {
  const ids = board => board.placements.map(p => `${p.id}:${p.memoryId}`).sort().join('|');
  return a.id === b.id && a.date === b.date && (a.membershipRevision || 0) === (b.membershipRevision || 0) && ids(a) === ids(b);
}

// Session-local layout snapshots contain no photo files or memory content.
// Membership changes form a new baseline so undo cannot resurrect deleted files.
function createBoardHistory(board, limit = 30) {
  let current, past = [], future = [];
  const capacity = Math.max(1, Math.floor(limit) || 30);
  function reset(next) { current = clone(next); past = []; future = []; }
  function sync(next) { if (!equal(current, next)) reset(next); }
  function record(next) {
    if (!sameMembers(current, next)) { reset(next); return false; }
    if (equal(current, next)) return false;
    past.push(current);
    if (past.length > capacity) past.shift();
    current = clone(next); future = []; return true;
  }
  function undo() {
    if (!past.length) return null;
    future.push(current); current = past.pop(); return clone(current);
  }
  function redo() {
    if (!future.length) return null;
    past.push(current); current = future.pop(); return clone(current);
  }
  function status() { return { canUndo: past.length > 0, canRedo: future.length > 0 }; }
  reset(board);
  return { reset, sync, record, undo, redo, status };
}
module.exports = { createBoardHistory };
