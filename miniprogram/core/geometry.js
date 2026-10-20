const config = require('./config');
const B = config.board;
const W = B.width - 2 * B.inset, H = B.height - 2 * B.inset;
function extent(p) {
  const a = p.angle * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  return { w: p.width * c + p.height * s, h: p.width * s + p.height * c };
}
function fit(input) {
  const p = Object.assign({}, input);
  p.angle = ((p.angle % 360) + 360) % 360;
  const e = extent(p);
  // Reserve the rounded inner corners as well as the straight edges.
  const margin = B.innerRadius * (1 - Math.SQRT1_2) + 4;
  const ratio = Math.min(1, (W - 2 * margin) / e.w, (H - 2 * margin) / e.h);
  p.width *= ratio; p.height *= ratio;
  const box = extent(p);
  p.x = Math.max(margin + box.w / 2, Math.min(W - margin - box.w / 2, p.x));
  p.y = Math.max(margin + box.h / 2, Math.min(H - margin - box.h / 2, p.y));
  return p;
}
function overlap(a, b, gap = 24) {
  const ae = extent(a), be = extent(b);
  const w = Math.max(0, Math.min(a.x + ae.w / 2 + gap, b.x + be.w / 2) - Math.max(a.x - ae.w / 2 - gap, b.x - be.w / 2));
  const h = Math.max(0, Math.min(a.y + ae.h / 2 + gap, b.y + be.h / 2) - Math.max(a.y - ae.h / 2 - gap, b.y - be.h / 2));
  return w * h;
}
function create(memoryId, width, height, z, createdAt, existing = []) {
  // Only the incoming object moves/shrinks. Never rearrange the user's work.
  const sizes = existing.length ? [420, 360, 300, 240, 180, 130] : [560];
  let best, bestScore = Infinity;
  for (const size of sizes) {
    const ratio = size / Math.max(width, height);
    const base = fit({ id: `p_${memoryId}`, memoryId, x: W / 2, y: H / 2, width: width * ratio, height: height * ratio, angle: 0, z, createdAt });
    const margin = B.innerRadius * (1 - Math.SQRT1_2) + 4;
    const xs = [W / 2], ys = [H / 2];
    // A regular grid plus exact neighbour edges finds gaps missed by the grid.
    for (let n = 0; n <= 16; n++) {
      xs.push(margin + base.width / 2 + (W - 2 * margin - base.width) * n / 16);
      ys.push(margin + base.height / 2 + (H - 2 * margin - base.height) * n / 16);
    }
    existing.forEach(p => {
      const e = extent(p);
      xs.push(p.x - (e.w + base.width) / 2 - 24, p.x + (e.w + base.width) / 2 + 24);
      ys.push(p.y - (e.h + base.height) / 2 - 24, p.y + (e.h + base.height) / 2 + 24);
    });
    let free, distance = Infinity;
    for (const x of xs) for (const y of ys) {
      const candidate = fit({ ...base, x, y });
      const area = existing.reduce((sum, p) => sum + overlap(candidate, p), 0);
      const d = Math.pow((candidate.x - W / 2) / W, 2) + Math.pow((candidate.y - H / 2) / H, 2);
      if (area < 0.001 && d < distance) { free = candidate; distance = d; }
      // Full boards still accept a bounded object at the least covered location.
      const score = area / (candidate.width * candidate.height) + d * 0.001;
      if (score < bestScore) { bestScore = score; best = candidate; }
    }
    if (free) return free;
  }
  return best;
}
function transform(p, op) {
  const next = Object.assign({}, p);
  if (op === 'ccw') next.angle -= config.rotationStep;
  if (op === 'cw') next.angle += config.rotationStep;
  if (op === 'up' || op === 'down') {
    const longest = Math.max(p.width, p.height);
    const target = Math.max(config.minSize, Math.min(config.maxSize, longest * (op === 'up' ? config.scaleStep : 1 / config.scaleStep)));
    next.width *= target / longest; next.height *= target / longest;
  }
  return fit(next);
}
function hit(p, x, y) {
  const a = -p.angle * Math.PI / 180, dx = x - p.x, dy = y - p.y;
  return Math.abs(dx * Math.cos(a) - dy * Math.sin(a)) <= p.width / 2 && Math.abs(dx * Math.sin(a) + dy * Math.cos(a)) <= p.height / 2;
}
function handles(p, screenWidth, screenHeight = screenWidth * B.height / B.width) {
  const s = screenWidth / B.width, e = extent(p), height = screenHeight;
  const cx = (B.inset + p.x) * s, cy = (B.inset + p.y) * s;
  const halfW = Math.max(50, e.w * s / 2 + 10), halfH = Math.max(50, e.h * s / 2 + 10);
  const clamp = (n, max) => Math.max(22, Math.min(max - 22, n));
  let left = clamp(cx - halfW, screenWidth), right = clamp(cx + halfW, screenWidth);
  // Keep room for the delete control between the two rotation controls,
  // including small stickers against either edge of the board.
  if (right - left < 104) {
    const center = Math.max(74, Math.min(screenWidth - 74, (left + right) / 2));
    left = center - 52; right = center + 52;
  }
  const top = clamp(cy - halfH, height), bottom = clamp(cy + halfH, height);
  return [ ['ccw', '↶', '逆时针旋转', left, top], ['cw', '↷', '顺时针旋转', right, top], ['down', '−', '缩小', left, bottom], ['up', '＋', '放大', right, bottom], ['remove', '×', '删除物件', (left + right) / 2, top] ].map(a => ({ op: a[0], icon: a[1], label: a[2], style: `left:${a[3] - 22}px;top:${a[4] - 22}px;` }));
}
module.exports = { W, H, extent, fit, create, transform, hit, handles };
