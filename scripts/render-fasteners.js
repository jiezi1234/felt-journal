// Synthetic paper cutouts exercise the production renderer without user photos.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const renderer = require('../miniprogram/core/renderer');
const fasteners = require('../miniprogram/core/sticker-fastener');
const styles = require('../miniprogram/core/fastener-style');
const material = require('../miniprogram/core/board-material');
const felt = require('../miniprogram/core/felt');
const B = require('../miniprogram/core/config').board;
const output = path.resolve(__dirname, '../artifacts/fasteners'); fs.mkdirSync(output, { recursive: true });
function sample(kind) {
  const canvas = createCanvas(400, 360), ctx = canvas.getContext('2d');
  if (kind === 'coffee') {
    ctx.fillStyle = '#FAF1DE'; ctx.strokeStyle = '#FFFDF5'; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.ellipse(195, 280, 170, 48, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(324, 176, 57, 52, 0, 0, Math.PI * 2); ctx.strokeStyle = '#F7EACB'; ctx.lineWidth = 27; ctx.stroke();
    material.rounded(ctx, 53, 72, 258, 203, 35); ctx.fillStyle = '#F7E9CA'; ctx.fill(); ctx.strokeStyle = '#FFFCED'; ctx.lineWidth = 14; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(182, 86, 127, 41, 0, 0, Math.PI * 2); ctx.fillStyle = '#9E6E44'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(181, 85, 105, 29, 0, 0, Math.PI * 2); ctx.strokeStyle = '#D7B483'; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(76, 132); ctx.lineTo(76, 226); ctx.strokeStyle = '#FFFBED'; ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.stroke();
  } else if (kind === 'leaf') {
    ctx.strokeStyle = '#FAF9EC'; ctx.lineWidth = 18; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(220, 325); ctx.quadraticCurveTo(190, 200, 160, 38); ctx.stroke();
    ctx.strokeStyle = '#718465'; ctx.lineWidth = 6; ctx.stroke();
    for (const [x, y, angle] of [[146, 90, -.5], [215, 140, .6], [146, 204, -.6], [244, 258, .8]]) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.beginPath(); ctx.ellipse(0, 0, 35, 66, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#8E9F7B'; ctx.fill(); ctx.strokeStyle = '#FAF9EC'; ctx.lineWidth = 10; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(0, 51); ctx.strokeStyle = '#D6DFC8'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    }
  } else {
    material.rounded(ctx, 18, 55, 364, 248, 9); ctx.fillStyle = '#FFFAE9'; ctx.fill();
    ctx.fillStyle = '#BE8065'; ctx.fillRect(18, 86, 364, 33);
    ctx.fillStyle = '#736344'; ctx.font = 'italic 38px Georgia'; ctx.fillText('a slower day', 56, 187);
    ctx.font = '16px Georgia'; ctx.fillText('COFFEE / SUNSHINE / OCTOBER', 52, 226);
    ctx.setLineDash([3, 5]); ctx.strokeStyle = '#CCBFA0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(48, 263); ctx.lineTo(352, 263); ctx.stroke();
  }
  return canvas;
}
const images = { coffee: sample('coffee'), leaf: sample('leaf'), ticket: sample('ticket') };
const model = { color: '#D9CBAF', texture: 'fine', items: [
  { memoryId: 'coffee', x: 400, y: 530, width: 610, height: 549, angle: -8, fastener: { kind: 'pin', color: 'sage', rotation: 0 }, memory: { subjectPath: 'coffee' } },
  { memoryId: 'leaf', x: 1030, y: 950, width: 570, height: 513, angle: 14, fastener: { kind: 'paperclip', color: 'brass', rotation: -6 }, memory: { subjectPath: 'leaf' } },
  { memoryId: 'ticket', x: 590, y: 1620, width: 690, height: 621, angle: -5, fastener: { kind: 'clip', color: 'clay', rotation: 4 }, memory: { subjectPath: 'ticket' } }
] };
const dimensions = { ...B, height: 2310 }, bounds = renderer.frame(dimensions);
function board(width) {
  const c = createCanvas(width, Math.round(width * bounds.height / bounds.width)), ctx = c.getContext('2d'), sy = c.height / bounds.height;
  ctx.setTransform(width / B.width, 0, 0, sy, 0, bounds.top * sy); renderer.paint(ctx, model, images, '', dimensions); return c;
}
for (const width of [390, 780, 1800]) fs.writeFileSync(path.join(output, `mixed-board-${width}.png`), board(width).toBuffer('image/png'));
const sheet = createCanvas(1320, 850), ctx = sheet.getContext('2d'); ctx.fillStyle = '#F6F2EA'; ctx.fillRect(0, 0, sheet.width, sheet.height);
ctx.fillStyle = '#443C30'; ctx.font = 'bold 30px "Microsoft YaHei"'; ctx.fillText('文具混搭 · 实际绘制效果', 35, 48);
ctx.font = '18px "Microsoft YaHei"'; ctx.fillStyle = '#857B6D'; ctx.fillText('放入时随机，贴好后保持不变', 35, 80);
ctx.drawImage(board(390), 28, 122);
let row = 0;
for (const [kind, palette] of Object.entries(styles.palettes)) {
  const top = 130 + row * 228;
  ctx.fillStyle = '#4E473B'; ctx.font = 'bold 22px "Microsoft YaHei"'; ctx.fillText({ pin: '哑光圆钉', clip: '迷你彩夹', paperclip: '细线回形针' }[kind], 470, top);
  ctx.save(); ctx.translate(455, top + 18); felt.paintSample(ctx, 820, 170, '#D9CBAF', 'fine'); ctx.restore();
  palette.forEach((color, n) => {
    const x = 535 + n * 151, y = top + 85;
    ctx.save(); ctx.translate(x, y); ctx.scale(1.75, 1.75);
    const hardware = { style: { kind, color, rotation: 0 }, radius: 23, x: 0, y: 0, angle: 0, worldAngle: 0 };
    fasteners.paint(ctx, hardware, 1.75, 'back');
    ctx.fillStyle = '#FDF8E8'; material.rounded(ctx, -33, kind === 'pin' ? -20 : 0, 66, 57, 3); ctx.fill();
    fasteners.paint(ctx, hardware, 1.75); ctx.restore();
  }); row++;
}
fs.writeFileSync(path.join(output, 'mixed-fasteners-preview.png'), sheet.toBuffer('image/png'));
console.log('Rendered production fasteners at 390/780/1800 px and an enlarged material contact sheet.');
