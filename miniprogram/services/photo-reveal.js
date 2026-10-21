const geometry = require('../core/photo-reveal');
const finalStyle = 'left:4%;top:4%;width:92%;height:92%;';
function clear(panel) {
  const r=panel.photoReveal;
  if(r) { clearTimeout(r.timer); r.token++; }
}
function later(panel,r,ms,fn) {
  clearTimeout(r.timer); const token=r.token;
  r.timer=setTimeout(()=>{ if(!panel.dead&&panel.photoReveal===r&&r.token===token) fn(); },ms);
}
function ready(panel,r) {
  clearTimeout(r.timer); r.pending=false;
  panel.setData({revealPhase:'ready',revealBusy:false,subjectVisible:true,originalHidden:true,revealError:''});
}
function failure(panel,r) {
  clear(panel); r.pending=false;
  panel.setData({revealPhase:'error',revealBusy:false,subjectVisible:false,originalHidden:false,revealError:'贴纸预览未载入，原图已保留，请重试预览。'});
}
function update(panel,task) {
  if(!task) { clear(panel); panel.photoReveal=null; return; }
  const key=task.id || task.original || task.previewOriginal || 'choosing';
  let r=panel.photoReveal;
  if(!r||r.key!==key) {
    const previous=r;
    clear(panel); r=panel.photoReveal={key,token:0,seenProcessing:false,subject:'',original:previous&&previous.original||'',
      originalInfo:previous&&previous.originalInfo,originalFailed:previous&&previous.originalFailed};
  }
  if(!['done','saveError','extractError','sourceError'].includes(task.state)) r.seenProcessing=true;
  const compare=panel.data.canCompare, source=task.state==='done'&&!compare ? task.subject||task.original : task.previewOriginal||task.original||'';
  if(source!==r.original) {r.original=source;r.originalInfo=null;r.originalFailed=false;}
  const subject=task.state==='done'&&compare ? task.subject : '';
  panel.setData({originalSrc:source});
  if(!subject) {
    clear(panel); r.subject=''; r.pending=false;
    panel.setData({subjectSrc:'',subjectVisible:false,originalHidden:false,revealBusy:false,revealPhase:'original',revealError:'',subjectStyle:finalStyle});
    return;
  }
  if(subject===r.subject) return;
  clear(panel); r.subject=subject; r.subjectInfo=null; r.pending=true; r.animate=r.seenProcessing; r.frame=task.alignment;
  panel.setData({subjectSrc:subject,subjectVisible:false,originalHidden:false,revealBusy:true,revealPhase:'loading',revealError:'',subjectStyle:finalStyle});
  later(panel,r,7000,()=>failure(panel,r));
}
function start(panel,r) {
  if(!r.pending||!r.subjectInfo||r.animate&&!r.originalInfo&&!r.originalFailed) return;
  r.pending=false; clearTimeout(r.timer);
  if(!r.animate) {ready(panel,r);return;}
  const token=r.token;
  const current=()=>!panel.dead&&panel.photoReveal===r&&r.token===token;
  const fallback=()=>{
    if(!current())return;
    // Legacy services lack crop coordinates: avoid overlapping unequal copies.
    panel.setData({revealPhase:'fallback-hide',originalHidden:true});
    later(panel,r,160,()=>{
      panel.setData({revealPhase:'fallback-show',subjectVisible:true});
      later(panel,r,180,()=>ready(panel,r));
    });
  };
  if(!geometry.alignment(r.frame)||!r.originalInfo) {fallback();return;}
  // Bound an unavailable layout callback as well as image decoding.
  later(panel,r,1500,()=>{if(current()&&panel.data.revealPhase==='loading')fallback();});
  panel.createSelectorQuery().select('#task-preview').boundingClientRect(box=>{
    if(!current()||panel.data.revealPhase!=='loading')return;
    const frames=geometry.frames(r.frame,r.originalInfo,r.subjectInfo,box);
    if(!frames) {fallback();return;}
    panel.setData({subjectStyle:geometry.style(frames.aligned,box),subjectVisible:true,revealPhase:'aligned'},()=>{
      if(!current())return;
      // The aligned PNG sits beneath an opaque original surface, so fading
      // the background does not dim or duplicate the foreground.
      later(panel,r,32,()=>{
        panel.setData({revealPhase:'fading',originalHidden:true});
        later(panel,r,520,()=>{
          panel.setData({revealPhase:'settling',subjectStyle:geometry.style(frames.final,box)});
          later(panel,r,260,()=>ready(panel,r));
        });
      });
    });
  }).exec();
}
function loaded(panel,kind,event) {
  const r=panel.photoReveal, source=event.currentTarget.dataset.src;
  if(!r||panel.dead||source!==(kind==='subject'?panel.data.subjectSrc:panel.data.originalSrc))return;
  const info=event.detail;
  if(!(info.width>0&&info.height>0)) {failed(panel,kind,event);return;}
  if(kind==='subject')r.subjectInfo={width:info.width,height:info.height};
  else r.originalInfo={width:info.width,height:info.height};
  start(panel,r);
}
function failed(panel,kind,event) {
  const r=panel.photoReveal;
  if(!r||panel.dead||event.currentTarget.dataset.src!==(kind==='subject'?panel.data.subjectSrc:panel.data.originalSrc))return;
  if(kind==='subject')failure(panel,r);
  else {r.originalFailed=true;start(panel,r);}
}
function retry(panel) {
  const r=panel.photoReveal;
  if(!r||!panel.data.task)return;
  clear(panel);r.subject='';
  panel.setData({subjectSrc:''},()=>{if(!panel.dead&&panel.photoReveal===r)update(panel,panel.data.task);});
}
module.exports={update,loaded,failed,retry,clear};
