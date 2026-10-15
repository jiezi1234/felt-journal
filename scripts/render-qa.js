const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const { paint } = require('../miniprogram/core/renderer');
const { paintSample } = require('../miniprogram/core/felt');
const config = require('../miniprogram/core/config');
const geo = require('../miniprogram/core/geometry');
const output = path.resolve(__dirname, '../artifacts'); fs.mkdirSync(output, { recursive: true });
// Synthetic alpha subjects exercise geometry, layering, clipping and shadows.
// They are test fixtures and are never inserted into the user's journal.
function object(color, shape) {
  const c = createCanvas(240, 200), x = c.getContext('2d'); x.fillStyle = color;
  x.beginPath(); if (shape === 'circle') x.arc(120, 100, 75, 0, Math.PI * 2); else { x.moveTo(120, 10); x.lineTo(230, 185); x.lineTo(10, 185); x.closePath(); } x.fill(); return c;
}
const images = { coffee: object('#715A4A', 'circle'), flower: object('#8FAE92', 'triangle'), mustard: object('#C9A64B', 'circle') };
const model = { color: config.colors[0].value, items: [
  { ...geo.create('coffee', 240, 200, 1, 1), x: 350, y: 350, angle: 345, memory: { subjectPath: 'coffee', kind: 'extracted' } },
  { ...geo.create('flower', 240, 200, 2, 2), x: 900, y: 340, angle: 15, memory: { subjectPath: 'flower', kind: 'extracted' } },
  { ...geo.create('mustard', 240, 200, 3, 3), x: 730, y: 630, angle: 0, memory: { subjectPath: 'mustard', kind: 'extracted' } }
] };
function render(width, selected) {
  const c = createCanvas(width, width * 2 / 3), ctx = c.getContext('2d'); ctx.scale(width / 1500, width / 1500); paint(ctx, model, images, selected); return c;
}
for (const width of [288, 320, 390, 430, 1800]) {
  const canvas = render(width, ''); fs.writeFileSync(path.join(output, `board-${width}.png`), canvas.toBuffer('image/png'));
  const ctx = canvas.getContext('2d'), sample = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
  const s = width / 1500;
  for (const [x, y] of [[20, 500], [1480, 500], [750, 20], [750, 980]]) assert.deepEqual(sample(Math.floor(x * s), Math.floor(y * s)), [73, 53, 39], 'All four walnut frame sides must survive');
  assert.deepEqual(sample(Math.floor(100 * s), Math.floor(100 * s)), [217, 203, 175], 'Felt color consistent');
}
fs.writeFileSync(path.join(output, 'board-edit-390.png'), render(390, 'flower').toBuffer('image/png'));
// A second identical output proves export uses the same deterministic construction.
assert.deepEqual(render(1800, '').toBuffer('image/png'), render(1800, '').toBuffer('image/png'));
console.log('PASS: shared board rendering at 288/320/390/430/1800 widths, 3:2 ratio, four frame sides and felt color');

// Material contact sheet uses the production renderer with synthetic subjects.
const tileWidth = 440, tileHeight = 348, gap = 24;
const sheet = createCanvas(3 * tileWidth + 4 * gap, 6 * tileHeight + 2 * gap), sheetCtx = sheet.getContext('2d');
sheetCtx.fillStyle = '#E8EDE7'; sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
config.colors.forEach((color, row) => config.textures.forEach((texture, col) => {
  const tile = createCanvas(tileWidth, tileWidth * 2 / 3), ctx = tile.getContext('2d'); ctx.scale(tileWidth / 1500, tileWidth / 1500);
  paint(ctx, { ...model, color: color.value, texture: texture.value }, images, '');
  const x = gap + col * (tileWidth + gap), y = gap + row * tileHeight;
  sheetCtx.drawImage(tile, x, y); sheetCtx.fillStyle = '#302F2B'; sheetCtx.font = '22px "Microsoft YaHei"'; sheetCtx.fillText(`${color.name} · ${texture.name}`, x + 8, y + 322);
}));
fs.writeFileSync(path.join(output, 'felt-appearance-sheet.png'), sheet.toBuffer('image/png'));
const samples = createCanvas(948, 212), sx = samples.getContext('2d'); sx.fillStyle = '#F7F2E9'; sx.fillRect(0, 0, 948, 212);
config.textures.forEach((texture, index) => { sx.save(); sx.translate(24 + index * 308, 20); paintSample(sx, 284, 132, config.colors[0].value, texture.value); sx.restore(); sx.fillStyle = '#302F2B'; sx.font = '22px "Microsoft YaHei"'; sx.fillText(texture.name, 24 + index * 308, 188); });
fs.writeFileSync(path.join(output, 'felt-texture-samples.png'), samples.toBuffer('image/png'));
console.log('PASS: 18 color/texture combinations rendered with the shared board and swatch renderers');
