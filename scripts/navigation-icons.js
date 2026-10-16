// Original rounded ink icons; no graphics are copied from the reference APK.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const directory = path.resolve(__dirname, '../miniprogram/images/navigation');
fs.mkdirSync(directory, { recursive: true });
const strokes = {
  today(ctx) {
    ctx.roundRect(4, 3, 16, 18, 5); ctx.moveTo(8, 8); ctx.lineTo(16, 8); ctx.moveTo(8, 12); ctx.lineTo(14, 12); ctx.moveTo(8, 16); ctx.lineTo(12, 16);
  },
  board(ctx) {
    ctx.roundRect(3, 3, 18, 18, 5); ctx.moveTo(9, 3); ctx.lineTo(9, 21); ctx.moveTo(9, 12); ctx.lineTo(21, 12);
  },
  calendar(ctx) {
    ctx.roundRect(3, 5, 18, 16, 4); ctx.moveTo(3, 10); ctx.lineTo(21, 10); ctx.moveTo(7, 3); ctx.lineTo(7, 7); ctx.moveTo(17, 3); ctx.lineTo(17, 7);
    for (const x of [7, 12, 17]) for (const y of [14, 18]) { ctx.moveTo(x - .25, y); ctx.lineTo(x + .25, y); }
  }
};
for (const [name, draw] of Object.entries(strokes)) for (const active of [false, true]) {
  const canvas = createCanvas(72, 72), ctx = canvas.getContext('2d'); ctx.scale(3, 3);
  ctx.strokeStyle = active ? '#554332' : '#ABA49A'; ctx.lineWidth = 2.1; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); draw(ctx); ctx.stroke();
  fs.writeFileSync(path.join(directory, `${name}${active ? '-active' : ''}.png`), canvas.toBuffer('image/png'));
}
const canvas = createCanvas(72, 72), ctx = canvas.getContext('2d'); ctx.scale(3, 3);
ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); strokes.board(ctx); ctx.stroke();
fs.writeFileSync(path.join(directory, 'board-nav.png'), canvas.toBuffer('image/png'));
console.log('PASS: seven original navigation icons generated');
