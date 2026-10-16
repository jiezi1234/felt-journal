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
function paint(ctx, model, images, selection) {
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
  // Render the editor's control faces in the canvas too: native canvas capture
  // may omit overlay layers. Hit targets remain independent native buttons.
  // Export calls paint() alone and never includes this UI-only pass.
  const scale = screenWidth / B.width;
  handles.forEach(handle => {
    const numbers = handle.style.match(/[\d.]+/g).map(Number);
    const x = (numbers[0] + 22) / scale, y = (numbers[1] + 22) / scale;
    ctx.save(); ctx.shadowColor = 'rgba(48,47,43,0.15)'; ctx.shadowBlur = 4 / scale; ctx.shadowOffsetY = 2 / scale;
    ctx.beginPath(); ctx.arc(x, y, 21 / scale, 0, Math.PI * 2); ctx.fillStyle = '#F7F2E9'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 1 / scale; ctx.strokeStyle = '#D9CBAF'; ctx.stroke();
    ctx.font = `${27 / scale}px sans-serif`; ctx.fillStyle = '#4A3C2F'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(handle.icon, x, y); ctx.restore();
  });
}
async function loadImages(canvas, items, cache, strict) {
  const result = cache || {}, paths = [...new Set(items.map(p => p.memory.subjectPath))];
  await Promise.all(paths.map(async path => { if (result[path] && !result[path].missing) return; try { result[path] = await loadImage(canvas, path); } catch (e) { if (strict) throw e; result[path] = { missing: true }; } }));
  return result;
}
module.exports = { paint, paintControls, loadImages, rounded, contain };
