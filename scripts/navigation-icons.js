// Local outline assets for the reference design's three navigation entries.
const fs = require('node:fs');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const directory = path.resolve(__dirname, '../miniprogram/images/navigation');
fs.mkdirSync(directory, { recursive: true });
const strokes = {
  today(ctx) {
    ctx.moveTo(3, 10); ctx.lineTo(12, 3); ctx.lineTo(21, 10); ctx.moveTo(5, 9); ctx.lineTo(5, 21); ctx.lineTo(19, 21); ctx.lineTo(19, 9);
    ctx.moveTo(10, 21); ctx.lineTo(10, 14); ctx.lineTo(14, 14); ctx.lineTo(14, 21); ctx.moveTo(7, 4); ctx.lineTo(7, 7);
  },
  board(ctx) {
    ctx.rect(3, 3, 18, 18); ctx.moveTo(10, 3); ctx.lineTo(10, 21); ctx.moveTo(10, 11); ctx.lineTo(21, 11);
  },
  calendar(ctx) {
    ctx.rect(3, 5, 18, 16); ctx.moveTo(3, 10); ctx.lineTo(21, 10); ctx.moveTo(7, 3); ctx.lineTo(7, 7); ctx.moveTo(17, 3); ctx.lineTo(17, 7);
    for (const x of [7, 12, 17]) for (const y of [14, 18]) { ctx.moveTo(x - .35, y); ctx.lineTo(x + .35, y); }
  }
};
for (const [name, draw] of Object.entries(strokes)) for (const active of [false, true]) {
  const canvas = createCanvas(72, 72), ctx = canvas.getContext('2d'); ctx.scale(3, 3);
  ctx.strokeStyle = active ? '#435E4E' : '#8A978E'; ctx.lineWidth = 1.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); draw(ctx); ctx.stroke();
  fs.writeFileSync(path.join(directory, `${name}${active ? '-active' : ''}.png`), canvas.toBuffer('image/png'));
}
console.log('PASS: six local navigation icons generated');
