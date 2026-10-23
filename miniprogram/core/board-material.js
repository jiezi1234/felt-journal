const config = require('./config');
const felt = require('./felt');
const anchors = new WeakMap();
function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function gradient(ctx, x1, y1, x2, y2, stops) {
  const g = ctx.createLinearGradient(x1, y1, x2, y2); stops.forEach(([at, color]) => g.addColorStop(at, color)); return g;
}
function oval(ctx, x, y, rx, ry) {
  ctx.save(); ctx.translate(x, y); ctx.scale(rx, ry); ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.restore();
}
function clip(ctx, width, pixelScale = 1) {
  ctx.save(); ctx.translate(width / 2, -176); ctx.scale(1.8, 1.8);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]);
  // Orthographic overhead view: circular handle, centered neck, parallel jaw.
  // Surface reflections and a tight contact shadow give depth without showing
  // a side wall, a second lever, or any perspective/foreshortening.
  const joinY=37, joinX=Math.sqrt(55*55-joinY*joinY), angle=Math.atan2(joinY,joinX);
  const body=()=>{
    ctx.beginPath(); ctx.moveTo(-joinX,5+joinY);
    ctx.bezierCurveTo(-33,65,-25,77,-35,97);
    ctx.quadraticCurveTo(-42,111,-66,129); ctx.lineTo(66,129);
    ctx.quadraticCurveTo(42,111,35,97);
    ctx.bezierCurveTo(25,77,33,65,joinX,5+joinY);
    ctx.arc(0,5,55,angle,Math.PI-angle,true); ctx.closePath();
    ctx.moveTo(18,5); ctx.arc(0,5,18,0,Math.PI*2); ctx.closePath();
  };
  ctx.shadowColor = 'rgba(48,57,43,.2)'; ctx.shadowBlur = 7*pixelScale*1.8;
  ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  body();
  ctx.fillStyle = gradient(ctx,-66,0,66,0,[[0,'#A5B0A3'],[.18,'#D8DFD2'],[.44,'#F3F6EC'],[.65,'#E5EBDF'],[.85,'#C4CEBE'],[1,'#A2AF9C']]);
  ctx.fill(); ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
  ctx.strokeStyle = '#8F9C89'; ctx.lineWidth = 1.8; ctx.stroke();
  // Broad face illumination follows the circular handle, with no offset rim.
  ctx.save(); body(); ctx.clip();
  const light=ctx.createRadialGradient(0,-15,6,0,5,62);
  light.addColorStop(0,'rgba(255,255,250,.55)'); light.addColorStop(.7,'rgba(255,255,250,.08)'); light.addColorStop(1,'rgba(78,99,73,.13)');
  ctx.fillStyle=light; ctx.fillRect(-56,-51,112,112); ctx.restore();
  ctx.beginPath(); ctx.arc(0,5,52,Math.PI*1.04,Math.PI*1.96);
  ctx.strokeStyle='rgba(255,255,249,.8)'; ctx.lineWidth=2; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,5,18,Math.PI,Math.PI*2);
  ctx.strokeStyle='#88977F'; ctx.lineWidth=2.4; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,5,18,0,Math.PI);
  ctx.strokeStyle='#F8FAF0'; ctx.lineWidth=2.4; ctx.stroke();
  // The jaw is a shallow, straight plate viewed squarely from above.
  ctx.shadowColor='rgba(48,57,43,.18)'; ctx.shadowBlur=6*pixelScale*1.8;
  rounded(ctx,-180,122,360,58,12);
  ctx.fillStyle=gradient(ctx,0,122,0,180,[[0,'#F5F7EF'],[.25,'#DFE6D9'],[.55,'#CBD5C4'],[.82,'#DCE4D4'],[1,'#B3C0AA']]); ctx.fill();
  ctx.shadowColor='transparent'; ctx.shadowBlur=0;
  ctx.strokeStyle='#8F9C89'; ctx.lineWidth=1.8; ctx.stroke();
  rounded(ctx,-176,126,352,50,9); ctx.strokeStyle='rgba(255,255,247,.65)'; ctx.lineWidth=1.2; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-162,153); ctx.lineTo(162,153);
  ctx.strokeStyle='rgba(99,117,87,.38)'; ctx.lineWidth=1.5; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-162,155); ctx.lineTo(162,155);
  ctx.strokeStyle='rgba(255,255,247,.65)'; ctx.lineWidth=1.2; ctx.stroke();
  ctx.restore();
}
function paint(ctx, model, B) {
  ctx.save(); ctx.clearRect(0, -B.overhang, B.width, B.height + B.overhang);
  rounded(ctx, 0, 0, B.width, B.height, B.radius);
  ctx.fillStyle = gradient(ctx, 0, 0, B.width, B.height, [[0,'#8B7054'],[.25,'#6B513B'],[.65,'#70543D'],[1,'#443629']]); ctx.fill();
  ctx.save(); rounded(ctx, 0, 0, B.width, B.height, B.radius); ctx.clip();
  ctx.lineWidth = 1.6;
  for (let n = 0; n < 38; n++) {
    const at = 3 + n * 1.13;
    ctx.strokeStyle = n % 3 ? 'rgba(35,24,16,.13)' : 'rgba(242,216,173,.16)'; ctx.beginPath();
    for (const y of [at, B.height - at]) { ctx.moveTo(0,y); ctx.bezierCurveTo(B.width*.3,y+8,B.width*.65,y-7,B.width,y+2); }
    for (const x of [at, B.width - at]) { ctx.moveTo(x,0); ctx.bezierCurveTo(x+5,B.height*.3,x-6,B.height*.7,x+1,B.height); }
    ctx.stroke();
  }
  ctx.restore();
  rounded(ctx, 6, 6, B.width - 12, B.height - 12, B.radius - 4);
  ctx.strokeStyle = 'rgba(243,219,179,.42)'; ctx.lineWidth = 6; ctx.stroke();
  rounded(ctx, 17, 17, B.width - 34, B.height - 34, B.radius - 12);
  ctx.strokeStyle = 'rgba(34,24,18,.38)'; ctx.lineWidth = 3; ctx.stroke();
  const i = B.inset, w = B.width - 2*i, h = B.height - 2*i;
  rounded(ctx, i-5, i-5, w+10, h+10, B.innerRadius+3); ctx.fillStyle = '#463C2E'; ctx.fill();
  rounded(ctx, i, i, w, h, B.innerRadius); ctx.fillStyle = model.color || config.colors[0].value; ctx.fill();
  ctx.save(); rounded(ctx, i, i, w, h, B.innerRadius); ctx.clip();
  felt.paintTexture(ctx, felt.textureOf(model), i, i, w, h);
  // Broad daylight keeps the felt soft without replacing its chosen color.
  felt.paintLight(ctx,i,i,w,h);
  rounded(ctx,i+25,i+25,w-50,h-50,Math.max(8,B.innerRadius-12));
  ctx.setLineDash([8,12]); ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(255,251,231,.38)'; ctx.stroke(); ctx.setLineDash([]);
  // The perimeter is compressed against the frame; the center keeps its color.
  ctx.fillStyle = gradient(ctx, 0, i, 0, i+h, [[0,'rgba(45,38,25,.18)'],[.035,'rgba(45,38,25,0)'],[.94,'rgba(255,253,230,0)'],[1,'rgba(255,253,230,.16)']]); ctx.fillRect(i,i,w,h);
  ctx.fillStyle = gradient(ctx, i, 0, i+w, 0, [[0,'rgba(45,38,25,.13)'],[.024,'rgba(45,38,25,0)'],[.976,'rgba(45,38,25,0)'],[1,'rgba(45,38,25,.1)']]); ctx.fillRect(i,i,w,h);
  ctx.restore();
  rounded(ctx, i+2, i+2, w-4, h-4, B.innerRadius-1); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,244,210,.32)'; ctx.stroke();
  ctx.restore();
}
function anchorOf(image, factory) {
  if (anchors.has(image)) return anchors.get(image);
  let anchor = { x:.5, y:.28, span:.18 };
  try {
    const create = factory || (typeof wx !== 'undefined' && wx.createOffscreenCanvas && (options => wx.createOffscreenCanvas(options)));
    let pixels, width, height;
    if (create) {
      const tile = create({ type:'2d',width:64,height:64 }), context = tile.getContext('2d');
      context.drawImage(image,0,0,64,64); pixels = context.getImageData(0,0,64,64).data; width = height = 64;
    } else if (image.getContext) {
      width = image.width; height = image.height; pixels = image.getContext('2d').getImageData(0,0,width,height).data;
    }
    if (pixels) {
      const opaque = (x,y) => pixels[(y*width+x)*4+3] > 180;
      let top=height, bottom=0;
      for (let y=0;y<height;y++) for (let x=0;x<width;x++) if (opaque(x,y)) { top=Math.min(top,y); bottom=Math.max(bottom,y); }
      const target = Math.min(height-1,top+Math.max(2,Math.round((bottom-top)*.12)));
      outer: for (let y=target;y<=bottom;y++) {
        let best, distance=Infinity;
        for (let x=1;x<width-1;x++) if (opaque(x-1,y)&&opaque(x,y)&&opaque(x+1,y)) {
          const d=Math.abs(x-width/2); if(d<distance) { best=x; distance=d; }
        }
        if (best!==undefined) {
          let left=best,right=best; while(left>0&&opaque(left-1,y))left--; while(right<width-1&&opaque(right+1,y))right++;
          anchor={x:(best+.5)/width,y:(y+.5)/height,span:(right-left+1)/width}; break outer;
        }
      }
    }
  } catch (_) { /* Older Canvas implementations use the neutral anchor. */ }
  anchors.set(image,anchor); return anchor;
}
function pin(ctx, size, id, angle, pixelScale, image) {
  let hash = 0; for (const c of String(id || 'pin')) hash = ((hash * 31) + c.charCodeAt(0)) >>> 0;
  const anchor = anchorOf(image), r = Math.max(6, Math.min(23,Math.min(size.width,size.height)*.08,anchor.span*size.width*.4));
  ctx.save(); ctx.translate((anchor.x-.5)*size.width,(anchor.y-.5)*size.height);
  ctx.rotate(-angle - [.18,.28,.12][hash%3]);
  // A close-to-overhead view shows the rounded cap and a short tapered waist.
  // One warm ivory resin keeps small pins quiet against different photographs.
  ctx.shadowColor = 'rgba(46,36,22,.24)'; ctx.shadowBlur = r*.48*pixelScale; ctx.shadowOffsetX = r*.28*pixelScale; ctx.shadowOffsetY = r*.32*pixelScale;
  oval(ctx, r*.27, -r*.2, r*.77, r*.48); ctx.fillStyle = 'rgba(65,49,28,.17)'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0,-r*.62); ctx.lineTo(0,0); ctx.lineWidth = r*.14; ctx.strokeStyle = '#707770'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r*.025,-r*.58); ctx.lineTo(-r*.025,-r*.04); ctx.lineWidth = r*.045; ctx.strokeStyle = '#F8FBF4'; ctx.stroke();
  oval(ctx, 0,-r*.34,r*.74,r*.38); ctx.fillStyle = '#A99A7D'; ctx.fill();
  oval(ctx, 0,-r*.4,r*.74,r*.37); ctx.fillStyle = gradient(ctx,-r*.5,-r*.7,r*.6,-r*.1,[[0,'#FFFDF2'],[.35,'#EAE0CA'],[.72,'#C8B99C'],[1,'#A99A7D']]); ctx.fill();
  const resin=gradient(ctx,-r*.7,0,r*.7,0,[[0,'#B7A68A'],[.22,'#F4EDDC'],[.38,'#FFF9EB'],[.57,'#E5D9C0'],[.8,'#C5B493'],[1,'#A39377']]);
  ctx.beginPath(); ctx.moveTo(-r*.7,-r*.44);
  ctx.bezierCurveTo(-r*.65,-r*.65,-r*.31,-r*.61,-r*.32,-r*.96);
  ctx.quadraticCurveTo(-r*.34,-r*1.16,-r*.53,-r*1.27); ctx.lineTo(r*.53,-r*1.27);
  ctx.quadraticCurveTo(r*.34,-r*1.16,r*.32,-r*.96);
  ctx.bezierCurveTo(r*.31,-r*.61,r*.65,-r*.65,r*.7,-r*.44);
  ctx.bezierCurveTo(r*.46,-r*.17,-r*.46,-r*.17,-r*.7,-r*.44); ctx.closePath(); ctx.fillStyle=resin; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-r*.28,-r*1.08); ctx.quadraticCurveTo(-r*.24,-r*.7,-r*.5,-r*.48);
  ctx.lineWidth=r*.065; ctx.strokeStyle='rgba(255,255,249,.72)'; ctx.stroke();
  // The underside rim gives the cap thickness without a heavy dark outline.
  oval(ctx,0,-r*1.2,r*.98,r*.54); ctx.fillStyle='#AD9E81'; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-r,-r*1.4); ctx.lineTo(-r*.98,-r*1.2);
  ctx.bezierCurveTo(-r*.85,-r*.58,r*.85,-r*.58,r*.98,-r*1.2); ctx.lineTo(r,-r*1.4); ctx.closePath();
  ctx.fillStyle=gradient(ctx,0,-r*1.7,0,-r*.7,[[0,'#F9F4E8'],[.55,'#E2D5BC'],[.85,'#B9A789'],[1,'#96866D']]); ctx.fill();
  oval(ctx,0,-r*1.43,r,r*.61);
  ctx.fillStyle=gradient(ctx,-r*.65,-r*2,r*.7,-r*.9,[[0,'#FFFFFF'],[.23,'#FCF9EE'],[.55,'#EEE6D4'],[.82,'#D4C5A9'],[1,'#BBAA8A']]); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-r*.86,-r*1.47); ctx.bezierCurveTo(-r*.76,-r*1.93,r*.22,-r*2.06,r*.66,-r*1.72);
  ctx.strokeStyle='rgba(255,255,253,.88)'; ctx.lineWidth=r*.045; ctx.stroke();
  oval(ctx,-r*.29,-r*1.63,r*.37,r*.16); ctx.fillStyle='rgba(255,255,255,.62)'; ctx.fill();
  ctx.restore();
}
module.exports = { rounded, paint, clip, pin, anchorOf };
