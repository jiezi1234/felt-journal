const clamp = value => Math.max(0, Math.min(1, value));
function bezier(value, x1, y1, x2, y2) {
  const x = clamp(value);
  const point = (t, a, b) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  let low = 0, high = 1;
  for (let i = 0; i < 14; i++) { const mid = (low + high) / 2; if (point(mid, x1, x2) < x) low = mid; else high = mid; }
  return x === 0 || x === 1 ? x : point((low + high) / 2, y1, y2);
}
const ease = progress => bezier(progress, .4, 0, .2, 1);
// U0.J.c / StickerPeelImage: source lifts upward, destination lays back down.
// X is linear across each row. Two triangles per row reproduce its 10x24 mesh
// on WeChat Canvas 2D, which has no Android drawBitmapMesh API.
function rows(width, height, progress, landing, amplitude, shadow = false) {
  const p = clamp(progress), fold = landing ? 1 - 1.8 * p : -.8 + 1.8 * p;
  return Array.from({ length: 25 }, (_, index) => {
    const y = index / 24;
    const u = clamp(((landing ? 1 - y : y) - fold) / .8);
    const lift = (1 - bezier(u, .5, 0, .5, 1)) * amplitude;
    const expanded = 1 + lift / (Math.max(amplitude, 1) * 18);
    const extra = lift * .055;
    return { left: width / 2 - width / 2 * expanded - extra / 2 + (shadow ? lift * .035 : 0),
      right: width / 2 + width / 2 * expanded + extra / 2 + (shadow ? lift * .035 : 0),
      y: height * y - .36 * lift + (shadow ? lift * .22 + 3 : 0), lift };
  });
}
function paint(ctx, image, width, height, progress, landing, amplitude, shadow = false) {
  const mesh = rows(width, height, progress, landing, amplitude, shadow);
  for (let row = 0; row < 24; row++) {
    const top = mesh[row], bottom = mesh[row + 1];
    const sy = image.height * row / 24, sh = image.height / 24;
    triangle(ctx, image, [[0, sy], [image.width, sy], [0, sy + sh]], [[top.left, top.y], [top.right, top.y], [bottom.left, bottom.y]]);
    triangle(ctx, image, [[image.width, sy], [image.width, sy + sh], [0, sy + sh]], [[top.right, top.y], [bottom.right, bottom.y], [bottom.left, bottom.y]]);
  }
}
function triangle(ctx, image, source, dest) {
  const [s0, s1, s2] = source, [d0, d1, d2] = dest;
  const sx1 = s1[0] - s0[0], sy1 = s1[1] - s0[1], sx2 = s2[0] - s0[0], sy2 = s2[1] - s0[1];
  const dx1 = d1[0] - d0[0], dy1 = d1[1] - d0[1], dx2 = d2[0] - d0[0], dy2 = d2[1] - d0[1];
  const denominator = sx1 * sy2 - sx2 * sy1;
  const a = (dx1 * sy2 - dx2 * sy1) / denominator, b = (dy1 * sy2 - dy2 * sy1) / denominator;
  const c = (dx2 * sx1 - dx1 * sx2) / denominator, d = (dy2 * sx1 - dy1 * sx2) / denominator;
  // Slightly overlap clipping edges; fractional image crop boundaries otherwise
  // produce visible horizontal seams in the WeChat Canvas rasterizer.
  const normals = dest.map((point, index) => {
    const next = dest[(index + 1) % 3], dx = next[0] - point[0], dy = next[1] - point[1], length = Math.hypot(dx, dy);
    return [dy / length, -dx / length];
  });
  ctx.save(); ctx.beginPath();
  dest.forEach((point, index) => {
    const before = normals[(index + 2) % 3], after = normals[index];
    const factor = .75 / Math.max(.0001, 1 + before[0] * after[0] + before[1] * after[1]);
    const x = point[0] + (before[0] + after[0]) * factor, y = point[1] + (before[1] + after[1]) * factor;
    if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath(); ctx.clip(); ctx.transform(a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1]);
  ctx.drawImage(image, 0, 0); ctx.restore();
}
module.exports = { rows, paint, ease, bezier };
