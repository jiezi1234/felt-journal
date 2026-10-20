const config = require('./config');
const felt = require('./felt');
const B = config.board;
function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function contain(p, image) { const scale = Math.min(p.width / image.width, p.height / image.height); return { width: image.width * scale, height: image.height * scale }; }
function paint(ctx, model, images, selection, dimensions = B) {
  const B = dimensions;
  ctx.clearRect(0, 0, B.width, B.height); ctx.fillStyle = '#E8EDE7'; ctx.fillRect(0, 0, B.width, B.height);
  rounded(ctx, 0, 0, B.width, B.height, B.radius); ctx.fillStyle = '#493527'; ctx.fill();
  rounded(ctx, 7, 7, B.width - 14, B.height - 14, B.radius - 7); ctx.strokeStyle = '#725841'; ctx.lineWidth = 5; ctx.stroke();
  const i = B.inset, w = B.width - 2 * i, h = B.height - 2 * i;
  rounded(ctx, i, i, w, h, B.innerRadius); ctx.fillStyle = model.color || config.colors[0].value; ctx.fill();
  ctx.save(); rounded(ctx, i, i, w, h, B.innerRadius); ctx.clip();
  felt.paintTexture(ctx, felt.textureOf(model), i, i, w, h);
  (model.items || []).forEach(p => {
    const image = images[p.memory.subjectPath];
    ctx.save(); ctx.translate(i + p.x, i + p.y); ctx.rotate(p.angle * Math.PI / 180);
    if (image && !image.missing) {
      const size = contain(p, image);
      ctx.shadowColor = 'rgba(48,47,43,0.24)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 5;
      ctx.drawImage(image, -size.width / 2, -size.height / 2, size.width, size.height);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      // The extraction service supplies the white sticker contour. Draw once so
      // semitransparent hair/fabric retains its original alpha and photo color.
    } else {
      ctx.fillStyle = '#F7F2E9'; ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
      ctx.fillStyle = '#73746D'; ctx.font = '36px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('照片缺失', 0, 10);
    }
    ctx.restore();
  });
  ctx.restore(); rounded(ctx, i, i, w, h, B.innerRadius); ctx.strokeStyle = 'rgba(48,32,19,0.24)'; ctx.lineWidth = 9; ctx.stroke();
  if (selection) {
    const p = (model.items || []).find(item => item.memoryId === selection);
    if (p) { ctx.save(); ctx.translate(i + p.x, i + p.y); ctx.rotate(p.angle * Math.PI / 180); ctx.strokeStyle = '#D9AD52'; ctx.lineWidth = 6; ctx.setLineDash([15, 12]); ctx.strokeRect(-p.width / 2 - 5, -p.height / 2 - 5, p.width + 10, p.height + 10); ctx.restore(); }
  }
}
function loadImage(canvas, path) {
  return new Promise((resolve, reject) => { const image = canvas.createImage(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('照片文件缺失，请在记忆详情替换照片')); image.src = path; });
}
function paintControls(ctx, handles, screenWidth) {
  // Canvas drawing and touch hit testing share the same screen-pixel centers.
  // Overlay controls and native canvas both accept the same touch gestures.
  // Export calls paint() alone and never includes this UI-only pass.
  const scale = screenWidth / B.width;
  handles.forEach(handle => {
    const x = handle.x / scale, y = handle.y / scale;
    ctx.save(); ctx.shadowColor = 'rgba(48,47,43,0.15)'; ctx.shadowBlur = 4 / scale; ctx.shadowOffsetY = 2 / scale;
    const removing = handle.op === 'remove';
    ctx.beginPath(); ctx.arc(x, y, 21 / scale, 0, Math.PI * 2); ctx.fillStyle = removing ? '#FFF1ED' : '#F7F2E9'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 1 / scale; ctx.strokeStyle = removing ? '#E8C1B7' : '#D9CBAF'; ctx.stroke();
    if (removing) {
      ctx.translate(x, y); ctx.scale(1 / scale, 1 / scale); ctx.strokeStyle = '#A44737'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      rounded(ctx, -6, -5, 12, 14, 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -7); ctx.lineTo(8, -7); ctx.moveTo(-3, -7); ctx.lineTo(-3, -10); ctx.lineTo(3, -10); ctx.lineTo(3, -7);
      ctx.moveTo(-2, -2); ctx.lineTo(-2, 5); ctx.moveTo(2, -2); ctx.lineTo(2, 5); ctx.stroke();
    } else {
      // Draw vectors so Android fonts cannot substitute missing handle glyphs.
      ctx.translate(x, y); ctx.scale(1 / scale, 1 / scale); ctx.strokeStyle = '#4A3C2F'; ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      if (handle.op === 'resize') {
        ctx.moveTo(-7, 7); ctx.lineTo(7, -7); ctx.moveTo(1, -7); ctx.lineTo(7, -7); ctx.lineTo(7, -1);
        ctx.moveTo(-1, 7); ctx.lineTo(-7, 7); ctx.lineTo(-7, 1);
      } else {
        ctx.arc(0, 0, 8, -Math.PI * .35, Math.PI * 1.25);
        ctx.moveTo(4, -10); ctx.lineTo(6, -5); ctx.lineTo(11, -7);
      }
      ctx.stroke();
    }
    ctx.restore();
  });
}
async function loadImages(canvas, items, cache, strict) {
  const result = cache || {}, paths = [...new Set(items.map(p => p.memory.subjectPath))];
  await Promise.all(paths.map(async path => { if (result[path] && !result[path].missing) return; try { result[path] = await loadImage(canvas, path); } catch (e) { if (strict) throw e; result[path] = { missing: true }; } }));
  return result;
}
module.exports = { paint, paintControls, loadImages, rounded, contain };
