// All crop coordinates are pixels in the rotated, then horizontally mirrored image.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
function size(width, height, turn) { return turn % 2 ? { width: height, height: width } : { width, height }; }
function initial(width, height) { return { turn: 0, flip: false, ratio: 0, crop: { x: 0, y: 0, width, height } }; }
function preset(bounds, ratio) {
  if (!ratio) return { x: 0, y: 0, width: bounds.width, height: bounds.height };
  const width = Math.min(bounds.width, bounds.height * ratio), height = width / ratio;
  return { x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height };
}
function rotate(edit, bounds) {
  const c = edit.crop;
  return { turn: (edit.turn + (edit.flip ? 3 : 1)) % 4, flip: edit.flip, ratio: edit.ratio ? 1 / edit.ratio : 0,
    crop: { x: bounds.height - c.y - c.height, y: c.x, width: c.height, height: c.width } };
}
function mirror(edit, bounds) { return Object.assign({}, edit, { flip: !edit.flip, crop: Object.assign({}, edit.crop, { x: bounds.width - edit.crop.x - edit.crop.width }) }); }
function drag(crop, handle, dx, dy, bounds, ratio, minSide) {
  const c = crop;
  if (handle === 'move') return Object.assign({}, c, { x: clamp(c.x + dx, 0, bounds.width - c.width), y: clamp(c.y + dy, 0, bounds.height - c.height) });
  if (!['nw', 'ne', 'sw', 'se'].includes(handle)) return Object.assign({}, c);
  const west = handle.includes('w'), north = handle.includes('n'), sx = west ? -1 : 1, sy = north ? -1 : 1;
  const ax = west ? c.x + c.width : c.x, ay = north ? c.y + c.height : c.y;
  const maxW = west ? ax : bounds.width - ax, maxH = north ? ay : bounds.height - ay;
  const minimumSide = minSide || 32;
  let width = clamp(c.width + sx * dx, Math.min(minimumSide, maxW), maxW), height = clamp(c.height + sy * dy, Math.min(minimumSide, maxH), maxH);
  if (ratio) {
    // Project the drag onto the ratio-constrained diagonal; keep the opposite corner fixed.
    const deltaW = (sx * dx + sy * dy / ratio) / (1 + 1 / (ratio * ratio));
    const limit = Math.min(maxW, maxH * ratio), minimum = Math.min(limit, Math.max(minimumSide, minimumSide * ratio));
    width = clamp(c.width + deltaW, minimum, limit); height = width / ratio;
  }
  return { x: west ? ax - width : ax, y: north ? ay - height : ay, width, height };
}
function changed(edit, width, height) {
  const c = edit.crop;
  return edit.turn !== 0 || edit.flip || Math.abs(c.x) > 0.01 || Math.abs(c.y) > 0.01 || Math.abs(c.width - width) > 0.01 || Math.abs(c.height - height) > 0.01;
}
function outputSize(crop, maxSide) {
  const scale = Math.min(1, (maxSide || 2048) / Math.max(crop.width, crop.height));
  return { width: Math.max(1, Math.round(crop.width * scale)), height: Math.max(1, Math.round(crop.height * scale)) };
}
function drawImage(ctx, image, edit) {
  const bounds = size(image.width, image.height, edit.turn);
  ctx.save(); ctx.translate(bounds.width / 2, bounds.height / 2); ctx.scale(edit.flip ? -1 : 1, 1); ctx.rotate(edit.turn * Math.PI / 2);
  ctx.drawImage(image, -image.width / 2, -image.height / 2, image.width, image.height); ctx.restore();
}
function render(canvas, image, edit, maxSide) {
  const output = outputSize(edit.crop, maxSide); canvas.width = output.width; canvas.height = output.height;
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, output.width, output.height);
  ctx.save(); ctx.scale(output.width / edit.crop.width, output.height / edit.crop.height); ctx.translate(-edit.crop.x, -edit.crop.y);
  drawImage(ctx, image, edit); ctx.restore(); return output;
}
module.exports = { size, initial, preset, rotate, mirror, drag, changed, outputSize, drawImage, render };
