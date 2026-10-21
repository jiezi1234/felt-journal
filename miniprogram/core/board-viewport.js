const board = require('./config').board;
const geometry = require('./geometry');

function dimensionsOf(width, height = width * board.height / board.width) {
  return { ...board, height: Math.max(board.height, height / width * board.width) };
}
function range(item, height) {
  const min = geometry.margin + geometry.extent(item).h / 2;
  return { min, span: Math.max(0, height - 2 * board.inset - 2 * min) };
}
function project(item, dimensions) {
  if (Number.isFinite(item.verticalAnchor)) {
    const bounds = range(item, dimensions.height);
    return { ...item, y: bounds.min + item.verticalAnchor * bounds.span };
  }
  // Older records retain their exact displayed positions until the user edits
  // them. Only new gestures opt into positioning across the full felt height.
  return { ...item, y: item.y * ((dimensions.height - 2 * board.inset) / geometry.H) };
}
function toDisplay(item, width, height) { return project(item, dimensionsOf(width, height)); }
function toStored(item, width, height) {
  // Keep sizes valid in the canonical 3:2 layout, but constrain the center on
  // the actual visible board. The anchor also works when a large rotated item
  // uses all the canonical height and its saved y has no room to move.
  const size = geometry.fit({ ...item, x: geometry.W / 2, y: geometry.H / 2 });
  const dimensions = dimensionsOf(width, height);
  const visible = geometry.fit({ ...item, width: size.width, height: size.height }, dimensions);
  const actual = range(visible, dimensions.height), saved = range(visible, board.height);
  const fraction = actual.span > 1e-8 ? Math.max(0, Math.min(1, (visible.y - actual.min) / actual.span)) : .5;
  const verticalAnchor = fraction < 1e-10 ? 0 : fraction > 1-1e-10 ? 1 : fraction;
  return geometry.fit({ ...visible, y: saved.min + verticalAnchor * saved.span, verticalAnchor });
}
function present(model, width, height) {
  const dimensions = dimensionsOf(width, height);
  return { dimensions, model: { ...model, items: (model.items || []).map(item => project(item, dimensions)) } };
}
module.exports = { present, toDisplay, toStored };
