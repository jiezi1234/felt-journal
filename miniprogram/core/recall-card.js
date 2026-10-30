const { rounded } = require('./board-material');
const outline = require('./recall-outline');
function subject(ctx, image, box) {
  const shape = outline.of(image);
  ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 3.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([5.3, 5.7]);
  ctx.shadowColor = 'rgba(100,78,43,.17)'; ctx.shadowBlur = 1.5; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 1;
  if (shape) {
    const b = shape.bounds, gap = shape.gap, sample = shape.sample;
    const scale = Math.min(box.width / (b.width + gap * 2), box.height / (b.height + gap * 2));
    const x = box.x + (box.width - b.width * scale) / 2 - b.x * scale, y = box.y + (box.height - b.height * scale) / 2 - b.y * scale;
    for (const points of shape.loops) {
      const first = points[0], last = points[points.length - 1];
      ctx.beginPath(); ctx.moveTo(x + (first.x + last.x) * scale / 2, y + (first.y + last.y) * scale / 2);
      points.forEach((p, i) => { const next = points[(i + 1) % points.length]; ctx.quadraticCurveTo(x + p.x * scale, y + p.y * scale, x + (p.x + next.x) * scale / 2, y + (p.y + next.y) * scale / 2); });
      ctx.closePath(); ctx.stroke();
    }
    ctx.shadowColor = 'transparent';
    // Use the sampled visible bounds so transparent padding cannot shrink the object.
    const sx = Math.max(0, (b.x - sample.x) / sample.scale), sy = Math.max(0, (b.y - sample.y) / sample.scale);
    const sw = Math.min(image.width, (b.x + b.width - sample.x) / sample.scale) - sx;
    const sh = Math.min(image.height, (b.y + b.height - sample.y) / sample.scale) - sy;
    ctx.drawImage(image, sx, sy, sw, sh, x + (sample.x + sx * sample.scale) * scale,
      y + (sample.y + sy * sample.scale) * scale, sw * sample.scale * scale, sh * sample.scale * scale);
  } else {
    const scale = Math.min((box.width - 12) / image.width, (box.height - 12) / image.height), w = image.width * scale, h = image.height * scale;
    const x = box.x + (box.width - w) / 2, y = box.y + (box.height - h) / 2;
    rounded(ctx, x - 5, y - 5, w + 10, h + 10, 9); ctx.stroke(); ctx.shadowColor = 'transparent'; ctx.drawImage(image, x, y, w, h);
  }
  ctx.setLineDash([]);
}
function paint(ctx, action, image, opacity = 1, pressed = false) {
  const { x, y, width, height } = action;
  ctx.save(); ctx.translate(x + width / 2, y + height / 2);
  const left = -width / 2 + 3, top = -height / 2 + 3, w = width - 6, h = height - 6;
  // The card stays quiet; the white stitches follow the old object's silhouette.
  const paper = ctx.createLinearGradient(0, top, 0, top + h);
  paper.addColorStop(0, pressed ? '#DFCFB2' : '#E8DAC1');
  paper.addColorStop(1, pressed ? '#CDBB9B' : '#D8C6A8');
  ctx.shadowColor = 'rgba(68,47,24,.14)'; ctx.shadowBlur = 6; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 3;
  rounded(ctx, left, top, w, h, 16); ctx.fillStyle = paper; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(255,252,240,.36)'; ctx.lineWidth = .6; ctx.setLineDash([]); ctx.stroke();
  ctx.save(); ctx.clip();
  for (let n = 0; n < 110; n++) { ctx.fillStyle = n % 2 ? 'rgba(142,118,87,.045)' : 'rgba(255,253,246,.11)'; ctx.fillRect(left + n * 17.31 % w, top + n * 31.73 % h, .6, .7); }
  ctx.restore();
  ctx.globalAlpha *= opacity;
  if (image && !image.missing) {
    subject(ctx, image, { x: left + 8, y: top + 8, width: w - 16, height: h - 33 });
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '11px sans-serif'; ctx.fillStyle = '#766249';
  ctx.fillText('往日一件', 0, top + h - 15, w - 14); ctx.restore();
}
module.exports = { paint, subject };
