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
function clip(ctx, width, pixelScale) {
  ctx.save(); ctx.translate(width / 2, 5);
  ctx.shadowColor = 'rgba(29,31,30,.35)'; ctx.shadowBlur = 20 * pixelScale; ctx.shadowOffsetY = 13 * pixelScale;
  rounded(ctx, -145, 20, 290, 96, 17);
  ctx.fillStyle = gradient(ctx, -145, 0, 145, 0, [[0,'#697174'],[.08,'#C5CCCA'],[.28,'#E4E7E1'],[.5,'#AAB1AE'],[.78,'#D3D8D3'],[1,'#687173']]); ctx.fill();
  ctx.shadowColor = 'transparent';
  rounded(ctx, -146, 104, 292, 16, 6); ctx.fillStyle = '#555D5C'; ctx.fill();
  rounded(ctx, -141, 104, 282, 5, 2); ctx.fillStyle = '#D7DBD4'; ctx.fill();
  rounded(ctx, -135, 29, 270, 70, 11);
  ctx.fillStyle = gradient(ctx, 0, 29, 0, 99, [[0,'#F0F1E9'],[.12,'#C6CCC6'],[.55,'#B7BFBA'],[1,'#8E9994']]); ctx.fill();
  ctx.save(); rounded(ctx, -134, 30, 268, 68, 10); ctx.clip(); ctx.lineWidth = .8;
  for (let y = 35; y < 96; y += 3) {
    ctx.strokeStyle = y % 2 ? 'rgba(255,255,246,.18)' : 'rgba(50,65,61,.11)'; ctx.beginPath(); ctx.moveTo(-130, y); ctx.lineTo(130, y); ctx.stroke();
  }
  ctx.restore();
  for (const x of [-112, 112]) {
    ctx.beginPath(); ctx.arc(x, 62, 7, 0, Math.PI * 2); ctx.fillStyle = '#68746E'; ctx.fill();
    ctx.beginPath(); ctx.arc(x - 1, 60, 4.5, 0, Math.PI * 2); ctx.fillStyle = '#D3D9D0'; ctx.fill();
  }
  // Folded wire handle: a dark edge and a narrow continuous reflection.
  const wire = () => {
    ctx.beginPath(); ctx.moveTo(-43, 73); ctx.lineTo(-44, 39); ctx.quadraticCurveTo(-43, 7, -22, 7);
    ctx.lineTo(22, 7); ctx.quadraticCurveTo(43, 7, 44, 39); ctx.lineTo(43, 73);
  };
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; wire(); ctx.lineWidth = 12; ctx.strokeStyle = '#626D69'; ctx.stroke();
  wire(); ctx.lineWidth = 7; ctx.strokeStyle = '#E3E8DF'; ctx.stroke();
  wire(); ctx.lineWidth = 2; ctx.strokeStyle = '#FFFFFF'; ctx.stroke();
  rounded(ctx, -53, 68, 106, 18, 8);
  ctx.fillStyle = gradient(ctx, 0, 68, 0, 86, [[0,'#7C8981'],[.3,'#E9EDE4'],[.55,'#BEC7BD'],[1,'#67756B']]); ctx.fill();
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
  const anchor = anchorOf(image), r = Math.max(5, Math.min(23,Math.min(size.width,size.height)*.085,anchor.span*size.width*.35));
  ctx.save(); ctx.translate((anchor.x-.5)*size.width,(anchor.y-.5)*size.height);
  ctx.rotate(-angle);
  ctx.shadowColor = 'rgba(37,31,23,.45)'; ctx.shadowBlur = r*.55*pixelScale; ctx.shadowOffsetX = r*.2*pixelScale; ctx.shadowOffsetY = r*.55*pixelScale;
  ctx.beginPath(); ctx.arc(0, r*.25, r*.76, 0, Math.PI*2); ctx.fillStyle = '#56564C'; ctx.fill();
  ctx.shadowColor = 'transparent';
  const colors = [['#F1E1B5','#BA9B61','#76623D'],['#EDF0E5','#AEB8AF','#5E6D62'],['#E3E6DF','#A2ACAA','#566362']][hash % 3];
  const cap = ctx.createRadialGradient(-r*.3,-r*.4,r*.06,0,0,r);
  cap.addColorStop(0,'#FFFDF0'); cap.addColorStop(.25,colors[0]); cap.addColorStop(.72,colors[1]); cap.addColorStop(1,colors[2]);
  ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.fillStyle = cap; ctx.fill();
  ctx.strokeStyle = 'rgba(57,56,43,.55)'; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.beginPath(); ctx.arc(0,0,r*.72,Math.PI*1.06,Math.PI*1.7); ctx.lineWidth = 1.7; ctx.strokeStyle = 'rgba(255,255,239,.75)'; ctx.stroke();
  ctx.restore();
}
module.exports = { rounded, paint, pin, anchorOf };
