const board = require('./config').board;

// Today expands vertically; save coordinates remain in the original 3:2 space.
function verticalRatio(width, height) {
  return (Math.max(board.height, height / width * board.width) - 2 * board.inset) / (board.height - 2 * board.inset);
}
function present(model, width, height) {
  const dimensions = { ...board, height: Math.max(board.height, height / width * board.width) };
  const ratio = (dimensions.height - 2 * board.inset) / (board.height - 2 * board.inset);
  return { dimensions, model: { ...model, items: (model.items || []).map(item => ({ ...item, y: item.y * ratio })) } };
}
module.exports = { present, verticalRatio };
