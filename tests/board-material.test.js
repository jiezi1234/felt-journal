const test = require('node:test');
const assert = require('node:assert/strict');
const {createCanvas} = require('@napi-rs/canvas');
const renderer = require('../miniprogram/core/renderer');
const material = require('../miniprogram/core/board-material');
const B = require('../miniprogram/core/config').board;

test('overhead clip has a centered circular handle and round transparent hole', () => {
  const canvas=createCanvas(1500,600),ctx=canvas.getContext('2d');ctx.translate(0,B.overhang);
  material.clip(ctx,B.width,1);
  const center={x:750,y:B.overhang-176+5*1.8};
  const alpha=(x,y)=>ctx.getImageData(Math.round(center.x+x),Math.round(center.y+y),1,1).data[3];
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    assert.ok(alpha(dx*24,dy*24)<64,'The page shows through the circular hole in every direction');
    assert.ok(alpha(dx*40,dy*40)>240,'The rim surrounds the hole without foreshortening');
    assert.ok(alpha(dx*90,dy*90)>240,'The handle retains equal horizontal and vertical radii');
  }
  for(const x of [-80,80])for(const y of [-80,80])assert.ok(alpha(x,y)<64,'The handle keeps a circular overhead silhouette');
});

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
  const bounds=renderer.frame(), height=Math.round(390*bounds.height/bounds.width);
  const canvas=createCanvas(390,height),model={color:'#D9CBAF',texture:'fine',items:[]};let builds=0;
  const factory=({width,height})=>{builds++;return createCanvas(width,height);};
  const cached=renderer.createSurface(canvas,model,B,null,factory);
  assert.strictEqual(renderer.createSurface(canvas,{...model,items:[{x:20}]},B,cached,factory),cached); assert.equal(builds,1);
  const color=renderer.createSurface(canvas,{...model,color:'#C3D0BD'},B,cached,factory);assert.notEqual(color.key,cached.key);
  const texture=renderer.createSurface(canvas,{...model,texture:'long'},B,cached,factory);assert.notEqual(texture.key,cached.key);
  const resized=renderer.createSurface(createCanvas(780,520),model,B,cached,factory);assert.notEqual(resized.key,cached.key);
  assert.equal(renderer.createSurface(canvas,model,B,null,()=>{throw Error('Unavailable');}),null);
  const direct=createCanvas(390,height),rendered=createCanvas(390,height);
  for(const [target,surface] of [[direct,null],[rendered,cached.canvas]]){
    const ctx=target.getContext('2d'),sy=height/bounds.height;ctx.setTransform(390/B.width,0,0,sy,0,bounds.top*sy);renderer.paint(ctx,model,{},'',B,surface);
  }
  const a=direct.getContext('2d').getImageData(0,0,390,height).data,b=rendered.getContext('2d').getImageData(0,0,390,height).data;
  let max=0;for(let n=0;n<a.length;n++)max=Math.max(max,Math.abs(a[n]-b[n]));assert.ok(max<=2,'Cached preview and direct export use the same material pixels');
});

test('clamp extends above the wooden board without cropping its opaque edge or filling the transparent margin', () => {
  for(const width of [320,430,1800]) {
    const bounds=renderer.frame(),height=Math.round(width*bounds.height/bounds.width),canvas=createCanvas(width,height),ctx=canvas.getContext('2d');
    const sy=height/bounds.height;ctx.setTransform(width/bounds.width,0,0,sy,0,bounds.top*sy);
    renderer.paint(ctx,{items:[],color:'#D9CBAF'}, {}, '');
    const top=Math.floor(bounds.top*sy),pixels=ctx.getImageData(0,0,width,top).data;
    assert.ok(pixels.some((v,i)=>i%4===3&&v>240),'Steel is visible above the frame');
    for(let x=0;x<width;x++)assert.ok(pixels[x*4+3]<64,'The top edge does not cut through the metal');
    assert.equal(ctx.getImageData(10,Math.floor(top/2),1,1).data[3],0,'Only the clamp occupies the headroom');
  }
});

test('steel jaws cover overlapping stickers and pins in both cached preview and direct export', () => {
  const sticker=createCanvas(560,340),ink=sticker.getContext('2d');ink.fillStyle='#FF00C8';ink.fillRect(0,0,560,340);
  const model={color:'#D9CBAF',texture:'fine',items:[{
    memoryId:'under-clip',x:705,y:190,width:560,height:340,angle:0,memory:{subjectPath:'sticker'}
  }]};
  for(const width of [390,1800]) {
    const dimensions={...B,height:width===390?2187.5:B.height},bounds=renderer.frame(dimensions);
    const height=Math.round(width*bounds.height/bounds.width),sx=width/bounds.width,sy=height/bounds.height;
    const draw=(items,surface)=>{
      const canvas=createCanvas(width,height),ctx=canvas.getContext('2d');ctx.setTransform(sx,0,0,sy,0,bounds.top*sy);
      renderer.paint(ctx,{...model,items},{sticker},'',dimensions,surface);return canvas;
    };
    const empty=draw([]),direct=draw(model.items);
    const cached=renderer.createSurface(direct,model,dimensions,null,({width,height})=>createCanvas(width,height));
    const preview=draw(model.items,cached.canvas);
    const pixel=(canvas,x,y)=>Array.from(canvas.getContext('2d').getImageData(Math.floor(x*sx),Math.floor((y+bounds.top)*sy),1,1).data);
    for(const canvas of [direct,preview]) {
      for(const x of [600,750,900])for(const y of [90,130]) {
        assert.deepEqual(pixel(canvas,x,y),pixel(empty,x,y),'The opaque jaw covers the object, including its pin');
      }
      assert.deepEqual(pixel(canvas,750,260),[255,0,200,255],'The object remains visible below the jaw');
    }
    const a=direct.getContext('2d').getImageData(0,0,width,height).data,b=preview.getContext('2d').getImageData(0,0,width,height).data;
    let max=0;for(let n=0;n<a.length;n++)max=Math.max(max,Math.abs(a[n]-b[n]));
    assert.ok(max<=2,'Cached preview and direct export keep identical overlap and shadow pixels');
  }
});

test('selection and transform controls remain visible above the steel clip', () => {
  const bounds=renderer.frame(),canvas=createCanvas(bounds.width,bounds.height),ctx=canvas.getContext('2d');
  ctx.translate(0,bounds.top);
  renderer.paint(ctx,{items:[{memoryId:'selected',x:705,y:190,width:560,height:340,angle:0,memory:{subjectPath:'missing'}}]}, {}, 'selected');
  const pixel=(x,y)=>Array.from(ctx.getImageData(x,y+bounds.top,1,1).data);
  assert.deepEqual(pixel(473,60),[217,173,82,255],'The selected outline stays above the jaw');
  renderer.paintControls(ctx,[{op:'resize',x:750,y:100}],B.width);
  assert.deepEqual(pixel(758,100),[247,242,233,255],'The resize control stays above the jaw');
});
