const { rounded } = require('./board-material');
function paint(ctx, action, image, opacity = 1, pressed = false) {
  const { x, y, width, height } = action;
  ctx.save(); ctx.translate(x + width / 2, y + height / 2); ctx.rotate(-3 * Math.PI / 180);
  const left = -width / 2 + 3, top = -height / 2 + 3, w = width - 6, h = height - 6;
  ctx.shadowColor = 'rgba(68,47,24,.22)'; ctx.shadowBlur = 8; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 4;
  rounded(ctx, left, top, w, h, 5); ctx.fillStyle = pressed ? '#F7EEDC' : '#FFFCF5'; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#E5DACC'; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
  // A small folded corner distinguishes this UI card from today's saved items.
  ctx.beginPath(); ctx.moveTo(left + w - 11, top + h); ctx.lineTo(left + w - 11, top + h - 11); ctx.lineTo(left + w, top + h - 11); ctx.closePath(); ctx.fillStyle = '#EDE2CF'; ctx.fill();
  ctx.globalAlpha *= opacity;
  if (image && !image.missing) {
    const space = h - 34, scale = Math.min((w - 12) / image.width, space / image.height);
    const iw = image.width * scale, ih = image.height * scale;
    ctx.drawImage(image, -iw / 2, top + 4 + (space - ih) / 2, iw, ih);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '11px sans-serif'; ctx.fillStyle = '#6E5B45';
  ctx.fillText('往日一件', 0, top + h - 23, w - 10); ctx.fillStyle = '#92816C'; ctx.font = '10px sans-serif';
  ctx.fillText(action.age, 0, top + h - 9, w - 16); ctx.restore();
}
module.exports = { paint };
