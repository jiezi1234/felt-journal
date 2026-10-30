const { rounded } = require('./board-material');
function paint(ctx, action, image, opacity = 1, pressed = false) {
  const { x, y, width, height } = action;
  ctx.save(); ctx.translate(x + width / 2, y + height / 2);
  const left = -width / 2 + 3, top = -height / 2 + 3, w = width - 6, h = height - 6;
  // A quiet paper tag shares the warm palette and inset stitching of Add.
  // Keep the silhouette upright and low on the edge of the notebook.
  const paper = ctx.createLinearGradient(0, top, 0, top + h);
  paper.addColorStop(0, pressed ? '#EADCC1' : '#F2E7D1');
  paper.addColorStop(1, pressed ? '#DFCDAB' : '#E8DABD');
  ctx.shadowColor = 'rgba(68,47,24,.13)'; ctx.shadowBlur = 4; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 2;
  rounded(ctx, left, top, w, h, 15); ctx.fillStyle = paper; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.strokeStyle = 'rgba(146,119,77,.18)'; ctx.lineWidth = .75; ctx.setLineDash([]); ctx.stroke();
  rounded(ctx, left + 4, top + 4, w - 8, h - 8, 11);
  ctx.strokeStyle = 'rgba(146,119,77,.24)'; ctx.setLineDash([1.5, 3]); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha *= opacity;
  if (image && !image.missing) {
    const space = h - 31, scale = Math.min((w - 18) / image.width, space / image.height);
    const iw = image.width * scale, ih = image.height * scale;
    ctx.drawImage(image, -iw / 2, top + 8 + (space - ih) / 2, iw, ih);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '10px sans-serif'; ctx.fillStyle = '#7D6B51';
  ctx.fillText('往日一件', 0, top + h - 15, w - 14); ctx.restore();
}
module.exports = { paint };
