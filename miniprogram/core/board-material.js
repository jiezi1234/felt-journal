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
function clip(ctx, width, pixelScale) {
  ctx.save(); ctx.translate(width / 2, 4);
  // Low-profile clipboard clamp: a hanging tab and spring wire sit behind the
  // stamped steel plate. Black end sleeves wrap its two folded corners.
  ctx.shadowColor = 'rgba(24,29,29,.35)'; ctx.shadowBlur = 13 * pixelScale; ctx.shadowOffsetY = 10 * pixelScale;
  rounded(ctx, -31, 0, 62, 49, 8);
  ctx.fillStyle = gradient(ctx, -31, 0, 31, 0, [[0,'#747E81'],[.17,'#DDE2E1'],[.45,'#F3F4EC'],[.83,'#B4BFBE'],[1,'#636F74']]); ctx.fill();
  ctx.shadowColor = 'transparent';
  oval(ctx, 0, 17, 12, 10); ctx.fillStyle = '#514537'; ctx.fill();
  ctx.strokeStyle = '#EDF0E8'; ctx.lineWidth = 3; ctx.stroke();
  const wire = () => {
    ctx.beginPath(); ctx.moveTo(-237, 61); ctx.quadraticCurveTo(-233, 28, -191, 29);
    ctx.lineTo(-111, 29); ctx.bezierCurveTo(-59, 29, -66, 10, 0, 10);
    ctx.bezierCurveTo(66, 10, 59, 29, 111, 29); ctx.lineTo(191, 29); ctx.quadraticCurveTo(233, 28, 237, 61);
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; wire(); ctx.lineWidth = 10; ctx.strokeStyle = '#657174'; ctx.stroke();
  wire(); ctx.lineWidth = 6; ctx.strokeStyle = '#D5DDDC'; ctx.stroke();
  ctx.save(); ctx.translate(0, -1.5); wire(); ctx.lineWidth = 2; ctx.strokeStyle = '#FAFCF5'; ctx.stroke(); ctx.restore();
  ctx.shadowColor = 'rgba(25,29,27,.4)'; ctx.shadowBlur = 15 * pixelScale; ctx.shadowOffsetY = 10 * pixelScale;
  rounded(ctx, -264, 42, 528, 76, 12);
  ctx.fillStyle = gradient(ctx, 0, 42, 0, 118, [[0,'#D7DDDA'],[.22,'#7F8C8E'],[.72,'#C1CAC7'],[1,'#4D595C']]); ctx.fill();
  ctx.shadowColor = 'transparent';
  rounded(ctx, -255, 33, 510, 74, 11);
  ctx.fillStyle = gradient(ctx, 0, 33, 0, 107, [[0,'#F0F3EF'],[.08,'#8D9A9B'],[.18,'#C1CAC8'],[.48,'#F1F3EB'],[.78,'#C5CDCA'],[1,'#8C999B']]); ctx.fill();
  ctx.strokeStyle = '#677578'; ctx.lineWidth = 2; ctx.stroke();
  // Fine cross-stamped marks read as metal at export resolution without noise
  // on the phone. Clip the pattern away from the polished folded edges.
  ctx.save(); rounded(ctx, -220, 43, 440, 51, 5); ctx.clip(); ctx.lineWidth = 1;
  for (let x = -280; x < 280; x += 7) {
    ctx.beginPath(); ctx.moveTo(x, 42); ctx.lineTo(x + 52, 95); ctx.strokeStyle = 'rgba(68,85,88,.1)'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, 42); ctx.lineTo(x - 52, 95); ctx.strokeStyle = 'rgba(255,255,249,.38)'; ctx.stroke();
  }
  ctx.restore();
  // The rolled front jaw provides the brightest reflection and a thin dark
  // contact line where the clamp presses against the board.
  rounded(ctx, -252, 99, 504, 14, 6);
  ctx.fillStyle = gradient(ctx, 0, 99, 0, 113, [[0,'#6D7B7D'],[.26,'#F9FCF4'],[.53,'#D4DCDA'],[1,'#556367']]); ctx.fill();
  for (const x of [-204, 204]) {
    oval(ctx, x, 69, 20, 17); ctx.fillStyle = '#6B7676'; ctx.fill();
    oval(ctx, x, 67, 18, 15); ctx.fillStyle = gradient(ctx, x-18, 52, x+18, 82, [[0,'#FFFFFF'],[.34,'#E2E6DF'],[.6,'#84918F'],[1,'#F4F4E9']]); ctx.fill();
    oval(ctx, x, 67, 12, 10); ctx.fillStyle = '#424B48'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#F0F0E4'; ctx.stroke();
    oval(ctx, x+1, 69, 8, 6); ctx.fillStyle = '#232A29'; ctx.fill();
  }
  for (const side of [-1, 1]) {
    ctx.save(); ctx.scale(side, 1);
    ctx.beginPath(); ctx.moveTo(226, 28); ctx.lineTo(255, 28); ctx.quadraticCurveTo(268, 29, 268, 42);
    ctx.lineTo(268, 97); ctx.quadraticCurveTo(267, 111, 254, 111); ctx.lineTo(237, 111);
    ctx.lineTo(237, 96); ctx.lineTo(246, 96); ctx.lineTo(246, 47); ctx.lineTo(222, 47);
    ctx.lineTo(222, 34); ctx.quadraticCurveTo(222, 28, 226, 28); ctx.closePath();
    ctx.fillStyle = gradient(ctx, 224, 28, 268, 106, [[0,'#414647'],[.22,'#252B2D'],[.63,'#171D20'],[1,'#333B3C']]); ctx.fill();
    ctx.strokeStyle = '#141B1D'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(228, 32); ctx.lineTo(255, 32); ctx.quadraticCurveTo(263, 33, 263, 43); ctx.lineTo(263, 96);
    ctx.strokeStyle = 'rgba(132,143,143,.38)'; ctx.lineWidth = 2; ctx.stroke();
    for (let y = 51; y < 94; y += 6) { ctx.beginPath(); ctx.moveTo(250, y); ctx.lineTo(260, y); ctx.strokeStyle = 'rgba(5,12,15,.42)'; ctx.stroke(); }
    ctx.restore();
  }
  ctx.restore();
}
function paint(ctx, model, B, pixelScale) {
  ctx.save(); ctx.clearRect(0, 0, B.width, B.height);
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
  // The perimeter is compressed against the frame; the center keeps its color.
  ctx.fillStyle = gradient(ctx, 0, i, 0, i+h, [[0,'rgba(45,38,25,.18)'],[.035,'rgba(45,38,25,0)'],[.94,'rgba(255,253,230,0)'],[1,'rgba(255,253,230,.16)']]); ctx.fillRect(i,i,w,h);
  ctx.fillStyle = gradient(ctx, i, 0, i+w, 0, [[0,'rgba(45,38,25,.13)'],[.024,'rgba(45,38,25,0)'],[.976,'rgba(45,38,25,0)'],[1,'rgba(45,38,25,.1)']]); ctx.fillRect(i,i,w,h);
  ctx.restore();
  rounded(ctx, i+2, i+2, w-4, h-4, B.innerRadius-1); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,244,210,.32)'; ctx.stroke();
  clip(ctx, B.width, pixelScale); ctx.restore();
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
  const anchor = anchorOf(image), r = Math.max(6, Math.min(24,Math.min(size.width,size.height)*.085,anchor.span*size.width*.4));
  ctx.save(); ctx.translate((anchor.x-.5)*size.width,(anchor.y-.5)*size.height);
  ctx.rotate(-angle - .2);
  // Keep the insertion point on the opaque subject. The tilted head exposes
  // both flanges and the narrow waist of a real pushpin, lit from the top left.
  ctx.shadowColor = 'rgba(37,31,23,.32)'; ctx.shadowBlur = r*.5*pixelScale; ctx.shadowOffsetX = r*.32*pixelScale; ctx.shadowOffsetY = r*.3*pixelScale;
  oval(ctx, r*.33, -r*.14, r*.8, r*.34); ctx.fillStyle = 'rgba(58,44,29,.19)'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.beginPath(); ctx.moveTo(0, -r*.72); ctx.lineTo(0, 0); ctx.lineCap = 'round'; ctx.lineWidth = Math.max(1.5, r*.18); ctx.strokeStyle = '#64716F'; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-r*.035, -r*.65); ctx.lineTo(-r*.035, -r*.08); ctx.lineWidth = Math.max(.7, r*.065); ctx.strokeStyle = '#F1F2E8'; ctx.stroke();
  const colors = [['#F5D398','#D6A253','#8D5B2E'],['#CCDCC7','#8FA895','#4D7267'],['#F0BBA3','#C47D64','#874E40']][hash % 3];
  const resin = gradient(ctx, -r, 0, r, 0, [[0,colors[2]],[.22,colors[0]],[.42,colors[1]],[.78,colors[1]],[1,colors[2]]]);
  oval(ctx, 0, -r*.55, r*.81, r*.32); ctx.fillStyle = colors[2]; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-r*.81, -r*.63);
  ctx.bezierCurveTo(-r*.76, -r*.9, -r*.32, -r*.87, -r*.32, -r*1.2);
  ctx.quadraticCurveTo(-r*.3, -r*1.58, -r*.58, -r*1.82);
  ctx.lineTo(r*.58, -r*1.82); ctx.quadraticCurveTo(r*.3, -r*1.58, r*.32, -r*1.2);
  ctx.bezierCurveTo(r*.32, -r*.87, r*.76, -r*.9, r*.81, -r*.63);
  ctx.bezierCurveTo(r*.6, -r*.32, -r*.6, -r*.32, -r*.81, -r*.63); ctx.closePath(); ctx.fillStyle = resin; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-r*.29, -r*1.56); ctx.quadraticCurveTo(-r*.4, -r, -r*.62, -r*.72);
  ctx.lineWidth = r*.08; ctx.strokeStyle = 'rgba(255,249,221,.5)'; ctx.stroke();
  oval(ctx, 0, -r*1.82, r, r*.36); ctx.fillStyle = colors[2]; ctx.fill();
  ctx.beginPath(); ctx.moveTo(-r, -r*2.04); ctx.lineTo(-r, -r*1.82);
  ctx.bezierCurveTo(-r, -r*1.36, r, -r*1.36, r, -r*1.82); ctx.lineTo(r, -r*2.04); ctx.closePath(); ctx.fillStyle = resin; ctx.fill();
  oval(ctx, 0, -r*2.04, r, r*.36);
  ctx.fillStyle = gradient(ctx, -r*.5, -r*2.4, r*.5, -r*1.7, [[0,'#FFF6DE'],[.2,colors[0]],[.7,colors[1]],[1,colors[2]]]); ctx.fill();
  ctx.strokeStyle = 'rgba(255,247,221,.5)'; ctx.lineWidth = r*.055; ctx.stroke();
  oval(ctx, -r*.28, -r*2.13, r*.43, r*.09); ctx.fillStyle = 'rgba(255,255,239,.57)'; ctx.fill();
  ctx.restore();
}
module.exports = { rounded, paint, pin, anchorOf };
