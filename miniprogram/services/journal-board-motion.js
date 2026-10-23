// Native canvas ignores ordinary view opacity on some devices. Blend two
// bitmaps instead of repainting felt, pins and photographs on every frame.
function copy(host) {
  const canvas = wx.createOffscreenCanvas({ type:'2d', width:host.canvas.width, height:host.canvas.height });
  canvas.getContext('2d').drawImage(host.canvas,0,0); return canvas;
}
function stop(host) {
  const motion = host.journalMotion;
  if (!motion) return;
  clearTimeout(motion.timer);
  if (motion.frame != null) {
    if (motion.native) motion.canvas.cancelAnimationFrame(motion.frame); else clearTimeout(motion.frame);
  }
  host.journalMotion = null;
  if (!host.dead) {
    const ctx = host.canvas.getContext('2d');
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.globalAlpha=1; ctx.clearRect(0,0,host.canvas.width,host.canvas.height);
    ctx.drawImage(motion.target,0,0,host.canvas.width,host.canvas.height); ctx.restore();
    host.setData({ navigationAnimating:false });
  }
}
function begin(host) {
  stop(host); host.journalSource = null;
  if (host.dead || !host.canvas || !host.data.model || typeof wx === 'undefined' || !wx.createOffscreenCanvas) return;
  try {
    host.journalSource = { canvas:copy(host), id:host.data.model.id };
    host.version = (host.version || 0) + 1;
  } catch (_) { /* Older runtimes keep the normal immediate board change. */ }
}
function run(host) {
  const source = host.journalSource;
  if (!source || host.data.covered || host.data.occluded || host.data.landingId) return false;
  host.journalSource = null;
  if (host.dead || !host.data.model || source.id === host.data.model.id) return false;
  let target;
  try { target = copy(host); } catch (_) { return false; }
  const motion = host.journalMotion = { target, canvas:host.canvas, started:Date.now(), frame:null };
  motion.timer=setTimeout(()=>{if(host.journalMotion===motion){stop(host);host.refresh();}},420);
  host.setData({ navigationAnimating:true, handles:[], actions:[], snapshotVisible:false, canvasHidden:false });
  const tick = () => {
    motion.frame = null;
    if (host.dead || host.journalMotion !== motion) return;
    if (host.data.covered || host.data.occluded || host.canvas !== motion.canvas) { stop(host); return; }
    const t = Math.min(1,(Date.now()-motion.started)/240), ease = t*t*(3-2*t);
    const ctx = host.canvas.getContext('2d'), width = host.canvas.width, height = host.canvas.height;
    ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,width,height);
    ctx.globalAlpha = 1; ctx.drawImage(source.canvas,0,0,width,height);
    ctx.globalAlpha = ease; ctx.drawImage(target,0,0,width,height); ctx.restore();
    if (t === 1) { stop(host); host.refresh(); return; }
    motion.native = !!(host.canvas.requestAnimationFrame && host.canvas.cancelAnimationFrame);
    motion.frame = motion.native ? host.canvas.requestAnimationFrame(tick) : setTimeout(tick,16);
  };
  tick(); return true;
}
function dispose(host) { stop(host); host.journalSource = null; }
module.exports = { begin, run, stop, dispose };
