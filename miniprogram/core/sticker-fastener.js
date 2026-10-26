const styles = require('./fastener-style');
const { rounded, anchorOf } = require('./board-material');
function layout(size, placement, image) {
  const style = styles.of(placement), anchor = anchorOf(image);
  const radius = Math.max(5, Math.min(23, Math.min(size.width, size.height) * .075, anchor.span * size.width * .38));
  return { style, radius, x: (anchor.x - .5) * size.width,
    y: ((style.kind === 'pin' ? anchor.y : anchor.edgeY) - .5) * size.height,
    angle: style.rotation * Math.PI / 180, worldAngle: ((placement.angle || 0) + style.rotation) * Math.PI / 180 };
}
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); }
function tint(ctx, palette, light) {
  const gradient = ctx.createLinearGradient(light.x, light.y, -light.x, -light.y);
  gradient.addColorStop(0, palette.light); gradient.addColorStop(.48, palette.base); gradient.addColorStop(1, palette.shade); return gradient;
}
function shadow(ctx, radius, pixelScale, strength = .2) {
  ctx.shadowColor = `rgba(48,40,28,${strength})`; ctx.shadowBlur = radius * .22 * pixelScale;
  ctx.shadowOffsetX = radius * .1 * pixelScale; ctx.shadowOffsetY = radius * .14 * pixelScale;
}
function clearShadow(ctx) { ctx.shadowColor = 'transparent'; ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0; }
function pin(ctx, palette, light, radius, pixelScale) {
  const oval = (x, y, rx, ry) => {
    ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry);
    circle(ctx, 0, 0, 1); ctx.restore();
  };
  // A short steel point meets the existing anchor. The resin foot, narrow waist
  // and broad cap retain a readable pushpin silhouette even at phone size.
  shadow(ctx, radius, pixelScale, .18);
  ctx.beginPath(); ctx.moveTo(0, .13); ctx.lineTo(.16, .62);
  ctx.strokeStyle = '#64716C'; ctx.lineWidth = .12; ctx.stroke(); clearShadow(ctx);
  ctx.beginPath(); ctx.moveTo(-.015, .15); ctx.lineTo(.12, .53);
  ctx.strokeStyle = '#E4E9E0'; ctx.lineWidth = .04; ctx.stroke();

  shadow(ctx, radius, pixelScale, .24);
  oval(0, .22, .78, .3); ctx.fillStyle = palette.shade; ctx.fill(); clearShadow(ctx);
  oval(0, .12, .78, .3); ctx.fillStyle = tint(ctx, palette, light); ctx.fill();
  ctx.strokeStyle = 'rgba(255,253,238,.25)'; ctx.lineWidth = .035; ctx.stroke();

  ctx.beginPath(); ctx.moveTo(-.47, -.91);
  ctx.bezierCurveTo(-.31, -.65, -.29, -.36, -.38, -.12);
  ctx.quadraticCurveTo(-.45, .04, -.68, .1);
  ctx.bezierCurveTo(-.4, .36, .4, .36, .68, .1);
  ctx.quadraticCurveTo(.45, .04, .38, -.12);
  ctx.bezierCurveTo(.29, -.36, .31, -.65, .47, -.91); ctx.closePath();
  ctx.fillStyle = tint(ctx, palette, { x: light.x * .7, y: light.y * .25 }); ctx.fill();
  // Fine side reflection, with a soft occlusion immediately beneath the cap.
  ctx.beginPath(); ctx.moveTo(-.28, -.65); ctx.quadraticCurveTo(-.24, -.32, -.34, -.1);
  ctx.strokeStyle = 'rgba(255,253,238,.28)'; ctx.lineWidth = .055; ctx.stroke();
  oval(0, -.69, .43, .15); ctx.fillStyle = 'rgba(49,43,31,.16)'; ctx.fill();

  shadow(ctx, radius, pixelScale, .16);
  oval(0, -.85, .88, .47); ctx.fillStyle = palette.shade; ctx.fill(); clearShadow(ctx);
  const cap = ctx.createRadialGradient(light.x * .3, -.98 + light.y * .22, .025, 0, -.98, 1.05);
  cap.addColorStop(0, palette.light); cap.addColorStop(.58, palette.base); cap.addColorStop(1, palette.shade);
  oval(0, -.98, .88, .47); ctx.fillStyle = cap; ctx.fill();
  ctx.strokeStyle = 'rgba(255,253,238,.28)'; ctx.lineWidth = .035; ctx.stroke();
}
function clip(ctx, palette, light, radius, pixelScale, back) {
  if (back) {
    shadow(ctx, radius, pixelScale, .16); rounded(ctx, -.86, .12, 1.72, .56, .12); ctx.fillStyle = palette.shade; ctx.fill(); return;
  }
  // Small spring lugs flank the pressed-metal handle; the jaw touches the photo.
  for (const side of [-1, 1]) {
    rounded(ctx, side * .66 - .12, -.39, .24, .57, .1); ctx.fillStyle = '#87918A'; ctx.fill();
    ctx.strokeStyle = '#D4DCD4'; ctx.lineWidth = .045; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(side * .66, -.28); ctx.lineTo(side * .66, .06); ctx.strokeStyle = '#58655E'; ctx.lineWidth = .055; ctx.stroke();
  }
  shadow(ctx, radius, pixelScale);
  ctx.beginPath(); ctx.moveTo(-.49, -1.25); ctx.quadraticCurveTo(-.49, -1.67, -.13, -1.67);
  ctx.lineTo(.13, -1.67); ctx.quadraticCurveTo(.49, -1.67, .49, -1.25);
  ctx.lineTo(.49, -.45); ctx.quadraticCurveTo(.49, -.12, .84, .12); ctx.lineTo(-.84, .12);
  ctx.quadraticCurveTo(-.49, -.12, -.49, -.45); ctx.closePath();
  // The mounting hole is transparent, so the felt actually shows through it.
  ctx.moveTo(.13, -1.2); ctx.arc(0, -1.2, .13, 0, Math.PI * 2, true);
  ctx.fillStyle = tint(ctx, palette, light); ctx.fill(); clearShadow(ctx);
  ctx.strokeStyle = palette.shade; ctx.lineWidth = .035; ctx.stroke();
  circle(ctx, 0, -1.2, .16); ctx.strokeStyle = 'rgba(255,250,230,.45)'; ctx.lineWidth = .035; ctx.stroke();
  shadow(ctx, radius, pixelScale, .17);
  rounded(ctx, -1, .04, 2, .52, .12); ctx.fillStyle = tint(ctx, palette, light); ctx.fill(); clearShadow(ctx);
  ctx.beginPath(); ctx.moveTo(-.83, .12); ctx.lineTo(.83, .12); ctx.strokeStyle = 'rgba(255,250,236,.48)'; ctx.lineWidth = .045; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-.85, .48); ctx.lineTo(.85, .48); ctx.strokeStyle = palette.shade; ctx.lineWidth = .055; ctx.stroke();
}
function paperclip(ctx, palette, light, radius, pixelScale, back) {
  const path = () => {
    ctx.beginPath();
    if (back) {
      ctx.moveTo(-.77, -.8); ctx.lineTo(-.77, 1.48);
      ctx.bezierCurveTo(-.77, 2.38, .77, 2.38, .77, 1.48); ctx.lineTo(.77, -.32);
    } else {
      ctx.moveTo(-.36, -.2); ctx.lineTo(-.36, 1.05);
      ctx.bezierCurveTo(-.36, 1.66, .52, 1.66, .52, 1.05); ctx.lineTo(.52, -1.15);
      ctx.bezierCurveTo(.52, -1.96, -.77, -1.96, -.77, -1.15); ctx.lineTo(-.77, -.8);
    }
  };
  // The long rear loop is drawn before the image, so only its uncovered part
  // remains visible. Three fine strokes give the wire thickness and reflection.
  shadow(ctx, radius, pixelScale, .24); path(); ctx.strokeStyle = palette.shade; ctx.lineWidth = .2; ctx.stroke(); clearShadow(ctx);
  path(); ctx.strokeStyle = tint(ctx, palette, light); ctx.lineWidth = .145; ctx.stroke();
  ctx.save(); ctx.translate(light.x * .028, light.y * .028); path();
  ctx.strokeStyle = palette.light; ctx.lineWidth = .04; ctx.stroke(); ctx.restore();
}
function paint(ctx, hardware, pixelScale = 1, pass = 'front') {
  const { style, radius, x, y, angle, worldAngle } = hardware, back = pass === 'back';
  if (back && style.kind === 'pin') return;
  const c = Math.cos(worldAngle), s = Math.sin(worldAngle), light = { x: -.6 * c - .8 * s, y: .6 * s - .8 * c };
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.scale(radius, radius);
  ctx.setLineDash([]); ctx.lineCap = ctx.lineJoin = 'round'; clearShadow(ctx);
  const palette = styles.colors[style.color];
  if (style.kind === 'pin') pin(ctx, palette, light, radius, pixelScale);
  else if (style.kind === 'clip') clip(ctx, palette, light, radius, pixelScale, back);
  else paperclip(ctx, palette, light, radius, pixelScale, back);
  ctx.restore();
}
module.exports = { layout, paint };
