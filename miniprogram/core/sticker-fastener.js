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
  shadow(ctx, radius, pixelScale); circle(ctx, 0, 0, .85); ctx.fillStyle = palette.shade; ctx.fill(); clearShadow(ctx);
  // A circular cap seen directly from above: no visible shaft or side profile.
  const dome = ctx.createRadialGradient(light.x * .36, light.y * .36, .05, light.x * .12, light.y * .12, 1.12);
  dome.addColorStop(0, palette.light); dome.addColorStop(.5, palette.base); dome.addColorStop(1, palette.shade);
  circle(ctx, 0, 0, .82); ctx.fillStyle = dome; ctx.fill();
  ctx.strokeStyle = 'rgba(255,253,238,.2)'; ctx.lineWidth = .035; ctx.stroke();
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
