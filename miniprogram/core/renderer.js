const config = require('./config');
const felt = require('./felt');
const material = require('./board-material');
const B = config.board;
const rounded = material.rounded;
function contain(p, image) { const scale = Math.min(p.width / image.width, p.height / image.height); return { width: image.width * scale, height: image.height * scale }; }
function paint(ctx, model, images, selection, dimensions = B, surface, pixelScale = ctx.canvas ? ctx.canvas.width / dimensions.width : 1) {
  const B = dimensions;
  ctx.clearRect(0, 0, B.width, B.height);
  if (surface) ctx.drawImage(surface, 0, 0, B.width, B.height); else material.paint(ctx, model, B, pixelScale);
  const i = B.inset, w = B.width - 2 * i, h = B.height - 2 * i;
  ctx.save(); rounded(ctx, i, i, w, h, B.innerRadius); ctx.clip();
  (model.items || []).forEach(p => {
    const image = images[p.memory.subjectPath];
    ctx.save(); ctx.translate(i + p.x, i + p.y); ctx.rotate(p.angle * Math.PI / 180);
    if (image && !image.missing) {
      const size = contain(p, image);
      ctx.shadowColor = 'rgba(48,40,29,0.3)'; ctx.shadowBlur = 18*pixelScale; ctx.shadowOffsetX = 2*pixelScale; ctx.shadowOffsetY = 9*pixelScale;
      ctx.drawImage(image, -size.width / 2, -size.height / 2, size.width, size.height);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
      material.pin(ctx, size, p.memoryId, p.angle * Math.PI / 180, pixelScale, image);
      // The extraction service supplies the white sticker contour. Draw once so
      // semitransparent hair/fabric retains its original alpha and photo color.
    } else {
      ctx.fillStyle = '#F7F2E9'; ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
      ctx.fillStyle = '#73746D'; ctx.font = '36px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('照片缺失', 0, 10);
    }
    ctx.restore();
  });
  ctx.restore();
  if (selection) {
    const p = (model.items || []).find(item => item.memoryId === selection);
    if (p) { ctx.save(); ctx.translate(i + p.x, i + p.y); ctx.rotate(p.angle * Math.PI / 180); ctx.strokeStyle = '#D9AD52'; ctx.lineWidth = 6; ctx.setLineDash([15, 12]); ctx.strokeRect(-p.width / 2 - 5, -p.height / 2 - 5, p.width + 10, p.height + 10); ctx.restore(); }
  }
}
function createSurface(canvas, model, dimensions = B, previous, factory) {
  const key = [canvas.width,canvas.height,dimensions.width,dimensions.height,model.color,felt.textureOf(model)].join(':');
  if (previous && previous.key === key) return previous;
  const create = factory || (typeof wx !== 'undefined' && wx.createOffscreenCanvas && (options => wx.createOffscreenCanvas(options)));
  if (!create) return null;
  try {
    const surface = create({ type:'2d', width:canvas.width, height:canvas.height }), ctx = surface.getContext('2d');
    ctx.setTransform(canvas.width / dimensions.width,0,0,canvas.height / dimensions.height,0,0);
    material.paint(ctx,model,dimensions,canvas.width / dimensions.width); return { key, canvas:surface };
  } catch (_) { return null; }
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
    // Draw the entire control in screen pixels, independently of the sticker's
    // rotation, board size and the previous canvas path/stroke settings.
    ctx.save(); ctx.translate(handle.x / scale, handle.y / scale); ctx.scale(1 / scale, 1 / scale);
    ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(48,47,43,0.15)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
    const removing = handle.op === 'remove';
    ctx.beginPath(); ctx.arc(0, 0, 21, 0, Math.PI * 2); ctx.fillStyle = removing ? '#FFF1ED' : '#F7F2E9'; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.lineWidth = 1; ctx.strokeStyle = removing ? '#E8C1B7' : '#D9CBAF'; ctx.stroke();
    ctx.lineWidth = 1.8;
    if (removing) {
      ctx.strokeStyle = '#A44737';
      rounded(ctx, -6, -5, 12, 14, 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(-8, -7); ctx.lineTo(8, -7); ctx.moveTo(-3, -7); ctx.lineTo(-3, -10); ctx.lineTo(3, -10); ctx.lineTo(3, -7);
      ctx.moveTo(-2, -2); ctx.lineTo(-2, 5); ctx.moveTo(2, -2); ctx.lineTo(2, 5); ctx.stroke();
    } else {
      // Draw vectors so Android fonts cannot substitute missing handle glyphs.
      ctx.strokeStyle = '#4A3C2F';
      ctx.beginPath();
      if (handle.op === 'resize') {
        // NW / SE arrows match pulling the bottom-right resize handle.
        ctx.moveTo(-7, -7); ctx.lineTo(7, 7);
        ctx.moveTo(-7, -1); ctx.lineTo(-7, -7); ctx.lineTo(-1, -7);
        ctx.moveTo(1, 7); ctx.lineTo(7, 7); ctx.lineTo(7, 1);
      } else {
        // A clockwise 270-degree arc; its arrowhead meets the exact end point
        // and follows the tangent, rather than intersecting the arc midway.
        const end = 8 * Math.SQRT1_2;
        ctx.translate(1, 1);
        ctx.arc(0, 0, 8, Math.PI / 4, 7 * Math.PI / 4);
        ctx.moveTo(end - 5, -end); ctx.lineTo(end, -end); ctx.lineTo(end, -end - 5);
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
module.exports = { paint, paintControls, loadImages, rounded, contain, createSurface };
