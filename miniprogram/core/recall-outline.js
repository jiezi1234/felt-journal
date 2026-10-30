// Thumbnail-only alpha sampling. Source photos and board exports are untouched.
const SIZE = 96, PAD = 10, GAP = 7;
const cache = new WeakMap();
function clean(data, width, height) {
  const mask = new Uint8Array(width * height), visited = new Uint8Array(mask.length), parts = [];
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= 32 ? 1 : 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const part = [start]; visited[start] = 1;
    for (let cursor = 0; cursor < part.length; cursor++) {
      const at = part[cursor], x = at % width, y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[next] && !visited[next]) { visited[next] = 1; part.push(next); }
      }
    }
    parts.push(part);
  }
  const threshold = Math.max(3, ...parts.map(p => p.length * .005));
  for (const part of parts) if (part.length < threshold) for (const at of part) mask[at] = 0;
  return mask;
}
function trace(mask, width, height) {
  const edges = [], starts = new Map(), stride = width + 1;
  const filled = (x, y) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x];
  function edge(x, y, nx, ny, direction) {
    const start = y * stride + x, end = ny * stride + nx, id = edges.length;
    edges.push({ start, end, direction, used: false });
    if (!starts.has(start)) starts.set(start, []);
    starts.get(start).push(id);
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (filled(x, y)) {
    if (!filled(x, y - 1)) edge(x, y, x + 1, y, 0);
    if (!filled(x + 1, y)) edge(x + 1, y, x + 1, y + 1, 1);
    if (!filled(x, y + 1)) edge(x + 1, y + 1, x, y + 1, 2);
    if (!filled(x - 1, y)) edge(x, y + 1, x, y, 3);
  }
  const loops = [], priority = [1, 0, 3, 2];
  for (const first of edges) {
    if (first.used) continue;
    const points = []; let current = first, closed = false;
    while (current && !current.used) {
      current.used = true; points.push({ x: current.start % stride, y: Math.floor(current.start / stride) });
      if (current.end === first.start) { closed = true; break; }
      const next = (starts.get(current.end) || []).map(id => edges[id]).filter(e => !e.used);
      next.sort((a, b) => priority.indexOf((a.direction - current.direction + 4) % 4) - priority.indexOf((b.direction - current.direction + 4) % 4));
      current = next[0];
    }
    const area = points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2;
    // Clockwise external loops only: internal holes do not get a second seam.
    if (closed && area >= 24) {
      const reduced = points.filter((p, i) => { const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length]; return (p.x - a.x) * (b.y - p.y) !== (p.y - a.y) * (b.x - p.x); });
      if (reduced.length >= 3) loops.push(reduced);
    }
  }
  return loops;
}
function fromAlpha(data, width, height, gap = GAP) {
  const source = clean(data, width, height), mask = new Uint8Array(width * height), offsets = [];
  let left = width, top = height, right = -1, bottom = -1;
  for (let dy = -gap; dy <= gap; dy++) for (let dx = -gap; dx <= gap; dx++) if (dx * dx + dy * dy <= gap * gap) offsets.push([dx, dy]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (source[y * width + x]) {
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
    for (const [dx, dy] of offsets) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < width && ny < height) mask[ny * width + nx] = 1; }
  }
  if (right < left) return null;
  const loops = trace(mask, width, height);
  return loops.length ? { loops, bounds: { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }, gap } : null;
}
function of(image, factory) {
  if (!image || image.missing || !image.width || !image.height) return null;
  if (cache.has(image)) return cache.get(image);
  let result = null;
  try {
    const create = factory || (typeof wx !== 'undefined' && wx.createOffscreenCanvas && (options => wx.createOffscreenCanvas(options)));
    if (create) {
      const canvas = create({ type: '2d', width: SIZE, height: SIZE }), ctx = canvas.getContext('2d');
      const scale = Math.min((SIZE - 2 * PAD) / image.width, (SIZE - 2 * PAD) / image.height);
      const x = (SIZE - image.width * scale) / 2, y = (SIZE - image.height * scale) / 2;
      ctx.clearRect(0, 0, SIZE, SIZE); ctx.drawImage(image, x, y, image.width * scale, image.height * scale);
      result = fromAlpha(ctx.getImageData(0, 0, SIZE, SIZE).data, SIZE, SIZE);
      if (result) result.sample = { x, y, scale };
    }
  } catch (_) { /* Older canvases retain the thumbnail with a rounded outline. */ }
  cache.set(image, result); return result;
}
module.exports = { of, fromAlpha };
