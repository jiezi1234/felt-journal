const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const outline = require('../miniprogram/core/recall-outline');
const card = require('../miniprogram/core/recall-card');
const factory = ({ width, height }) => createCanvas(width, height);
function sample(draw, width = 180, height = 180) {
  const image = createCanvas(width, height), ctx = image.getContext('2d'); ctx.fillStyle = '#B98142'; draw(ctx); return image;
}
function inside(loop, x, y) {
  let hit = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
test('seam follows a concave alpha silhouette instead of a fixed rectangular card outline', () => {
  const image = sample(ctx => { ctx.fillRect(20,20,40,140); ctx.fillRect(20,120,140,40); });
  const before = image.toBuffer('image/png'), result = outline.of(image, factory), { x, y, scale } = result.sample;
  assert.equal(result.loops.length, 1);
  assert.equal(inside(result.loops[0], x + 35 * scale, y + 35 * scale), true);
  assert.equal(inside(result.loops[0], x + 140 * scale, y + 140 * scale), true);
  assert.equal(inside(result.loops[0], x + 120 * scale, y + 60 * scale), false, 'The missing corner stays outside the seam');
  assert.deepEqual(image.toBuffer('image/png'), before, 'Sampling does not modify the saved subject');
});
test('internal holes have no seam; meaningful disconnected pieces stay separate and alpha dust is ignored', () => {
  const image = sample(ctx => { ctx.beginPath();ctx.arc(90,90,65,0,Math.PI*2);ctx.arc(90,90,35,0,Math.PI*2,true);ctx.fill(); });
  assert.equal(outline.of(image, factory).loops.length, 1);
  const data = new Uint8ClampedArray(96 * 96 * 4);
  const fill = (x,y,w,h) => { for(let py=y;py<y+h;py++)for(let px=x;px<x+w;px++)data[(py*96+px)*4+3]=255; };
  fill(12,30,18,30); fill(64,30,18,30); fill(2,2,1,1);
  const result = outline.fromAlpha(data,96,96);
  assert.equal(result.loops.length,2); assert.equal(result.bounds.x,12); assert.equal(result.bounds.y,30);
});
test('transparent padding is measured independently of image size and both wide and tall photos keep their shape', () => {
  const padded = sample(ctx => ctx.fillRect(280,120,70,100), 500, 400), r = outline.of(padded, factory);
  assert.ok(r.bounds.width / r.sample.scale < 85); assert.ok(r.bounds.height / r.sample.scale < 115);
  assert.ok(Math.abs((r.bounds.x - r.sample.x) / r.sample.scale - 280) < 8);
  for(const [w,h] of [[480,80],[80,480]]) {
    const result = outline.of(sample(ctx=>ctx.fillRect(0,0,w,h),w,h),factory);
    assert.equal(result.loops.length,1);
    assert.ok(Math.abs(result.bounds.width / result.bounds.height - w / h) < .4);
    assert.ok(result.loops.flat().every(p=>p.x>=0&&p.y>=0&&p.x<=96&&p.y<=96));
  }
});
test('one bounded sample is cached per image and unreadable pixels do not prevent card rendering', () => {
  const image = sample(ctx=>ctx.fillRect(20,20,140,140)); let reads = 0;
  const read = options => { reads++; assert.equal(options.width,96);assert.equal(options.height,96);return factory(options); };
  assert.strictEqual(outline.of(image,read),outline.of(image,read)); assert.equal(reads,1);
  const fallback = sample(ctx=>ctx.fillRect(20,20,140,140)); let failures = 0;
  const unavailable = () => { failures++;throw Error('Pixel reads unavailable'); };
  assert.equal(outline.of(fallback,unavailable),null); assert.equal(outline.of(fallback,unavailable),null); assert.equal(failures,1);
  const canvas = createCanvas(110,140);
  assert.doesNotThrow(()=>card.paint(canvas.getContext('2d'),{x:10,y:10,width:84,height:110},fallback));
  assert.equal(outline.of(sample(()=>{}),factory),null); assert.equal(outline.of({missing:true}),null);
});
test('fitting cropped subjects preserves the source aspect ratio even at sample boundaries', t => {
  for (const [width,height] of [[480,80],[80,480],[213,137]]) {
    const image=sample(ctx=>ctx.fillRect(0,0,width,height),width,height);outline.of(image,factory);
    const ctx=createCanvas(120,150).getContext('2d'),draw=t.mock.method(ctx,'drawImage');
    card.paint(ctx,{x:10,y:10,width:84,height:110},image);
    const args=draw.mock.calls[0].arguments;
    assert.ok(args[1]>=0&&args[2]>=0&&args[1]+args[3]<=width&&args[2]+args[4]<=height);
    assert.ok(Math.abs(args[7]/args[8]-args[3]/args[4])<.00001,'Thumbnail scaling cannot stretch the photo');
  }
});
test('warm card and white stitches render at compact sizes without leaking ink outside the card', () => {
  const image = sample(ctx=>{ctx.fillRect(30,40,90,90);ctx.beginPath();ctx.arc(125,75,30,-Math.PI/2,Math.PI/2);ctx.fill();});
  outline.of(image,factory);
  for(const width of [48,63,84]) {
    const canvas = createCanvas(220,280),ctx=canvas.getContext('2d');ctx.scale(2,2);
    card.paint(ctx,{x:12,y:12,width,height:width+26},image);
    const pixels=ctx.getImageData(0,0,220,280).data;
    let white=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i]>245&&pixels[i+1]>245&&pixels[i+2]>245&&pixels[i+3]>240)white++;
    assert.ok(white>30,'The white seam is visible over the warm paper');
    assert.equal(ctx.getImageData(0,0,1,1).data[3],0);
    assert.equal(ctx.getImageData(215,275,1,1).data[3],0);
  }
});
