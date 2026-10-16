const B = require('./config').board;
function validRect(rect) { return rect && [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0; }
function imageRect(rect, image) {
  if (!validRect(rect) || !(image.width > 0 && image.height > 0)) return null;
  const scale = Math.min(rect.width / image.width, rect.height / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { left: rect.left + (rect.width - width) / 2, top: rect.top + (rect.height - height) / 2, width, height };
}
function landingRect(rect, placement) {
  if (!validRect(rect) || !placement) return null;
  const scale = rect.width / B.width;
  const size = imageRect({ left: 0, top: 0, width: placement.width, height: placement.height }, placement.memory);
  if (!size) return null;
  return { left: rect.left + (B.inset + placement.x - size.width / 2) * scale,
    top: rect.top + (B.inset + placement.y - size.height / 2) * scale,
    width: size.width * scale, height: size.height * scale, angle: placement.angle };
}
// Motion is UI-only: final geometry always comes from the saved placement.
function transform(source, target) {
  return { x: target.left + target.width / 2 - source.left - source.width / 2,
    y: target.top + target.height / 2 - source.top - source.height / 2,
    scale: target.width / source.width, angle: target.angle || 0 };
}
module.exports = { imageRect, landingRect, transform, validRect };
