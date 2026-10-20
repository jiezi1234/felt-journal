const test = require('node:test');
const assert = require('node:assert/strict');
const {createCanvas} = require('@napi-rs/canvas');
const renderer = require('../miniprogram/core/renderer');
const material = require('../miniprogram/core/board-material');
const B = require('../miniprogram/core/config').board;

test('pin anchors land on visible alpha instead of the empty center or transparent padding', () => {
  const image=createCanvas(200,200),ctx=image.getContext('2d');ctx.fillStyle='#A97F50';ctx.fillRect(130,100,30,70);
  const before=image.toBuffer('image/png');let samples=0;
  const factory=({width,height})=>{samples++;return createCanvas(width,height);};
  const anchor=material.anchorOf(image,factory);
  assert.ok(anchor.x>.64&&anchor.x<.81&&anchor.y>.5&&anchor.y<.85);
  assert.ok(ctx.getImageData(Math.floor(anchor.x*200),Math.floor(anchor.y*200),1,1).data[3]>180);
  assert.strictEqual(material.anchorOf(image,factory),anchor); assert.equal(samples,1);
  assert.ok(before.equals(image.toBuffer('image/png')),'Hardware never edits the saved photo');
});

test('surface cache reuses material while stickers move and invalidates color, texture and dimensions', () => {
  const canvas=createCanvas(390,260),model={color:'#D9CBAF',texture:'fine',items:[]};let builds=0;
  const factory=({width,height})=>{builds++;return createCanvas(width,height);};
  const cached=renderer.createSurface(canvas,model,B,null,factory);
  assert.strictEqual(renderer.createSurface(canvas,{...model,items:[{x:20}]},B,cached,factory),cached); assert.equal(builds,1);
  const color=renderer.createSurface(canvas,{...model,color:'#C3D0BD'},B,cached,factory);assert.notEqual(color.key,cached.key);
  const texture=renderer.createSurface(canvas,{...model,texture:'long'},B,cached,factory);assert.notEqual(texture.key,cached.key);
  const resized=renderer.createSurface(createCanvas(780,520),model,B,cached,factory);assert.notEqual(resized.key,cached.key);
  assert.equal(renderer.createSurface(canvas,model,B,null,()=>{throw Error('Unavailable');}),null);
  const direct=createCanvas(390,260),rendered=createCanvas(390,260);
  for(const [target,surface] of [[direct,null],[rendered,cached.canvas]]){
    const ctx=target.getContext('2d');ctx.scale(390/B.width,390/B.width);renderer.paint(ctx,model,{},'',B,surface);
  }
  const a=direct.getContext('2d').getImageData(0,0,390,260).data,b=rendered.getContext('2d').getImageData(0,0,390,260).data;
  let max=0;for(let n=0;n<a.length;n++)max=Math.max(max,Math.abs(a[n]-b[n]));assert.ok(max<=2,'Cached preview and direct export use the same material pixels');
});
