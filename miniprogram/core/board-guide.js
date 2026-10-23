const { rounded } = require('./board-material');
const B = require('./config').board;

// Guidance belongs to the live UI, never to the saved/exported board artwork.
function layout(model, width, height, actions) {
  const add = actions.find(a => a.kind === 'journal-add');
  if (!model || (model.items || []).length || !add || add.disabled) return null;
  const scale = Math.min(1, (add.y - 20) / 230, width / 300);
  if (scale <= 0) return null;
  const y = Math.max(75 * scale, Math.min(height * .42, add.y - 125 * scale));
  return { x:width / 2, y, scale, arrowEnd:add.y - 20 };
}
function paint(ctx, guide, screenWidth) {
  if (!guide) return;
  ctx.save(); ctx.scale(B.width / screenWidth, B.width / screenWidth);
  ctx.translate(guide.x, guide.y);
  ctx.scale(guide.scale, guide.scale);
  ctx.setLineDash([]); ctx.lineWidth = 1.7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(91,76,55,.38)';
  // Two small, imperfect photo prints feel at home on a handmade felt board.
  ctx.save(); ctx.translate(-16,-25); ctx.rotate(-.16);
  rounded(ctx,-34,-35,60,72,5); ctx.fillStyle = 'rgba(255,252,240,.25)'; ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.save(); ctx.translate(14,-18); ctx.rotate(.12);
  rounded(ctx,-31,-35,62,73,5); ctx.fillStyle = 'rgba(255,252,240,.52)'; ctx.fill(); ctx.stroke();
  rounded(ctx,-23,-27,46,44,2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-22,8); ctx.lineTo(-7,-8); ctx.lineTo(4,3); ctx.lineTo(11,-4); ctx.lineTo(23,9); ctx.stroke();
  ctx.beginPath(); ctx.arc(10,-16,4,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-12,27); ctx.lineTo(12,27); ctx.stroke(); ctx.restore();
  ctx.beginPath(); ctx.moveTo(54,-51); ctx.lineTo(54,-39); ctx.moveTo(48,-45); ctx.lineTo(60,-45);
  ctx.moveTo(-55,-11); ctx.lineTo(-55,-3); ctx.moveTo(-59,-7); ctx.lineTo(-51,-7); ctx.stroke();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#77674F'; ctx.font = '17px "Songti SC", SimSun, serif';
  ctx.fillText('把值得记住的，留在这里',0,49,screenWidth-52);
  ctx.fillStyle = '#85745D'; ctx.font = '12px sans-serif';
  ctx.fillText('点击下方 ＋，添加第一件记忆',0,77,screenWidth-48);
  const end = (guide.arrowEnd - guide.y) / guide.scale;
  if (end > 123) {
    ctx.strokeStyle = 'rgba(111,91,61,.42)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(12,102);
    ctx.bezierCurveTo(40,123,-24,end-33,0,end);
    ctx.moveTo(-8,end-8); ctx.lineTo(0,end); ctx.lineTo(4,end-12); ctx.stroke();
  }
  ctx.restore();
}
module.exports = { layout, paint };
