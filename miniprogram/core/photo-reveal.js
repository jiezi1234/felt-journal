// Coordinates describe the final PNG (including its paper edge) in the
// oriented, resized original. They stay transient; journal data is unchanged.
function alignment(value) {
  if (!value || typeof value !== 'object') return null;
  const keys = ['sourceWidth','sourceHeight','x','y','width','height'];
  if (!keys.every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) return null;
  const {sourceWidth:w,sourceHeight:h,x,y,width,height} = value, margin = Math.max(w,h)*.3;
  if (w<1 || h<1 || w>24000 || h>24000 || width<1 || height<1 || x < -margin || y < -margin || x+width>w+margin || y+height>h+margin) return null;
  return keys.reduce((result,key) => {result[key]=value[key];return result;},{});
}
function fit(width,height,boxWidth,boxHeight,fraction=1) {
  const scale=Math.min(boxWidth*fraction/width,boxHeight*fraction/height);
  return {left:(boxWidth-width*scale)/2,top:(boxHeight-height*scale)/2,width:width*scale,height:height*scale};
}
function frames(value,original,subject,box) {
  const a=alignment(value);
  if (!a || !original || !subject || !box || !(box.width>0&&box.height>0&&subject.width>0&&subject.height>0&&original.width>0&&original.height>0)) return null;
  // A stale frame or a differently oriented/cropped result must never be
  // animated as if it matched the original.
  if (Math.abs((original.width/original.height)/(a.sourceWidth/a.sourceHeight)-1)>.02 || Math.abs((subject.width/subject.height)/(a.width/a.height)-1)>.02) return null;
  const source=fit(a.sourceWidth,a.sourceHeight,box.width,box.height), scale=source.width/a.sourceWidth;
  return {aligned:{left:source.left+a.x*scale,top:source.top+a.y*scale,width:a.width*scale,height:a.height*scale},
    final:fit(subject.width,subject.height,box.width,box.height,.92)};
}
function style(frame,box) {
  return ['left','top','width','height'].map(key => `${key}:${frame[key]/(key==='left'||key==='width'?box.width:box.height)*100}%;`).join('');
}
module.exports={alignment,fit,frames,style};
