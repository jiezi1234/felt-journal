const board = require('./config').board;

// Only the home preview expands to the available height. Saved coordinates,
// editing and exports retain their original 3:2 composition.
function present(model, width, height) {
  const dimensions = { ...board, height: Math.max(board.height, height / width * board.width) };
  const ratio = (dimensions.height - 2 * board.inset) / (board.height - 2 * board.inset);
  return { dimensions, model: { ...model, items: (model.items || []).map(item => ({ ...item, y: item.y * ratio })) } };
}
module.exports = { present };
