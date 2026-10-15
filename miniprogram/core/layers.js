// Match draw order and hit testing, including legacy layouts with tied z values.
function ordered(placements) {
  return placements.slice().sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
}
function availability(board, memoryId) {
  const placements = ordered(board.placements), index = placements.findIndex(p => p.memoryId === memoryId);
  return { canBringToFront: index >= 0 && index < placements.length - 1, canSendToBack: index > 0 };
}
function move(board, memoryId, direction) {
  const placements = ordered(board.placements), index = placements.findIndex(p => p.memoryId === memoryId);
  if (index < 0 || !['front', 'back'].includes(direction)) return board;
  if (direction === 'front' ? index === placements.length - 1 : index === 0) return board;
  const selected = placements.splice(index, 1)[0];
  if (direction === 'front') placements.push(selected); else placements.unshift(selected);
  const ranks = new Map(placements.map((p, i) => [p.id, i + 1]));
  // Normalize only z; preserve placement-array order, geometry and calendar dates.
  return Object.assign({}, board, { placements: board.placements.map(p => Object.assign({}, p, { z: ranks.get(p.id) })) });
}
module.exports = { ordered, availability, move };
