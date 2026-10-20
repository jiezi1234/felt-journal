const config = require('./config');
const B = config.board;
function textureOf(board) { return board.texture === undefined ? config.defaultTexture : board.texture; }
function withTexture(board) { return Object.assign({}, board, { texture: textureOf(board) }); }
// Fixed logical coordinates keep the material stable across redraws and exports.
function paintTexture(ctx, texture, x, y, width, height) {
  ctx.save();
  if (texture === 'long') {
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? 2 : 2.6; ctx.strokeStyle = pass ? 'rgba(255,252,238,0.24)' : 'rgba(76,65,48,0.13)'; ctx.beginPath();
      for (let n = 0; n < 1800; n++) {
        const px = x + ((n * 137.51 + pass * 43.1) % width), py = y + ((n * 73.17 + pass * 27.3) % height);
        const angle = (n * 2.399963) % (Math.PI * 2), length = 12 + n % 17;
        const dx = Math.cos(angle) * length, dy = Math.sin(angle) * length;
        ctx.moveTo(px, py); ctx.quadraticCurveTo(px + dx / 2 + 3, py + dy / 2 - 3, px + dx, py + dy);
      }
      ctx.stroke();
    }
  } else if (texture === 'cross') {
    for (let pass = 0; pass < 2; pass++) {
      ctx.lineWidth = pass ? 2.4 : 3; ctx.strokeStyle = pass ? 'rgba(255,252,238,0.28)' : 'rgba(76,65,48,0.13)'; ctx.beginPath();
      for (let row = 0; row < Math.ceil(height / 20); row++) for (let col = 0; col < Math.ceil(width / 20); col++) {
        const n = row * 71 + col, px = x + col * 20 + (n * 7.31 % 5), py = y + row * 20 + (n * 3.17 % 5);
        const dx = 15 + n % 5, dy = pass ? -9 : 9;
        ctx.moveTo(px, py + (pass ? 12 : 0)); ctx.lineTo(px + dx, py + (pass ? 12 : 0) + dy);
      }
      ctx.stroke();
    }
  } else {
    // Fine remains the default material for records without a texture field.
    ctx.lineWidth = 1.6; ctx.strokeStyle = 'rgba(88,72,47,0.075)'; ctx.beginPath();
    for (let n = 0; n < 1600; n++) { const px = x + ((n * 137.51) % width), py = y + ((n * 73.17) % height); ctx.moveTo(px, py); ctx.lineTo(px + (n % 3) + 2, py + (n % 2 ? 3 : -3)); }
    ctx.stroke();
  }
  // Short irregular fibers catch light in both directions. Coordinates are
  // deterministic, so a drag or export never makes the material shimmer.
  const fibers = Math.ceil(width * height / 470);
  for (let pass = 0; pass < 2; pass++) {
    ctx.lineWidth = pass ? 1.3 : 1.7;
    ctx.strokeStyle = pass ? 'rgba(255,252,231,.25)' : 'rgba(69,59,40,.12)'; ctx.beginPath();
    for (let n = 0; n < fibers; n++) {
      const px = x + ((n * 137.51 + pass * 31.7) % width), py = y + ((n * 73.17 + pass * 19.3) % height);
      const angle = n * 2.399963, length = 5 + n % 13, dx = Math.cos(angle)*length, dy = Math.sin(angle)*length;
      ctx.moveTo(px,py); ctx.quadraticCurveTo(px+dx*.5+2,py+dy*.5-1,px+dx,py+dy);
    }
    ctx.stroke();
  }
  ctx.restore();
}
function paintSample(ctx, width, height, color, texture) {
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
  ctx.fillStyle = color || config.colors[0].value; ctx.fillRect(0, 0, width, height);
  // A close view of the same material, without a second approximation in CSS.
  const scale = width / 260; ctx.scale(scale, scale); ctx.translate(-240, -260);
  paintTexture(ctx, texture, B.inset, B.inset, B.width - 2 * B.inset, B.height - 2 * B.inset); ctx.restore();
}
module.exports = { textureOf, withTexture, paintTexture, paintSample };
