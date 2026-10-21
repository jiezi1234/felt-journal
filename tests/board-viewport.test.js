const test = require('node:test');
const assert = require('node:assert/strict');
const viewport = require('../miniprogram/core/board-viewport');
const geometry = require('../miniprogram/core/geometry');
const { board: B } = require('../miniprogram/core/config');
const { createStore, validate } = require('../miniprogram/core/store');
const dates = require('../miniprogram/core/date');
const close = (a, b) => assert.ok(Math.abs(a-b)<1e-7, `${a} must equal ${b}`);

test('moves reach both actual felt edges for different sizes, rotations and viewport heights', () => {
  for (const width of [320,430]) for (const height of [width*2/3,600]) {
    for (const size of [110,280,850]) for (const angle of [0,37,90]) {
      const item = geometry.fit({ x:705,y:455,width:size,height:size*.8,angle });
      for (const edge of [0,1]) {
        const saved = viewport.toStored({...item,y:edge?1e6:-1e6},width,height);
        const display = viewport.present({items:[saved]},width,height), p=display.model.items[0], box=geometry.extent(p);
        const gap = edge ? display.dimensions.height-2*B.inset-p.y-box.h/2 : p.y-box.h/2;
        close(gap,geometry.margin); close(p.width,item.width); close(p.height,item.height);
        assert.deepEqual(geometry.fit(saved),saved);
        if (display.dimensions.height-2*B.inset-box.h-2*geometry.margin>1e-8) assert.equal(saved.verticalAnchor,edge);
        close(viewport.toDisplay(saved,1500,1000).y,saved.y);
      }
    }
  }
});

test('legacy positions are read without moving objects or adding placement metadata', () => {
  const model={items:[geometry.fit({x:500,y:180,width:250,height:220,angle:15})]}, before=JSON.stringify(model);
  const display=viewport.present(model,360,600);
  close(display.model.items[0].y,model.items[0].y*(2500-90)/910);
  assert.equal(JSON.stringify(model),before); assert.equal(display.model.items[0].verticalAnchor,undefined);
});

test('display positions round trip through save coordinates and adapt to a different screen', () => {
  const item=geometry.fit({x:700,y:400,width:320,height:260,angle:23});
  for (const y of [240,900,2000]) {
    const saved=viewport.toStored({...item,y},360,600), shown=viewport.toDisplay(saved,360,600);
    close(shown.y,y); close(shown.x,item.x);
    for (const [width,height] of [[430,700],[360,240]]) {
      const p=viewport.toDisplay(saved,width,height), innerHeight=Math.max(1000,height/width*1500)-90;
      const min=geometry.margin+geometry.extent(p).h/2;
      close((p.y-min)/(innerHeight-2*min),saved.verticalAnchor);
    }
  }
});

test('full-height rotated objects retain edge positions after saving and reloading', () => {
  const disk={},storage={get:key=>disk[key],set:(key,value)=>{disk[key]=value;}},store=createStore(storage),date=dates.key();
  store.add('edge',date,{originalPath:'/original.png',subjectPath:'/subject.png',width:100,height:100});
  const draft=store.board(date), item=geometry.fit({...draft.placements[0],width:850,height:850,angle:45});
  const top=viewport.toStored({...item,y:-1e6},360,600), bottom=viewport.toStored({...item,y:1e6},360,600);
  close(top.y,bottom.y); assert.equal(top.verticalAnchor,0); assert.equal(bottom.verticalAnchor,1);
  for (const placement of [top,bottom]) {
    draft.placements=[placement];store.saveBoard(draft);
    const reloaded=createStore(storage); reloaded.load(); validate(reloaded.get());
    assert.deepEqual(reloaded.board(date).placements[0],placement);
    const p=viewport.toDisplay(placement,360,600), box=geometry.extent(p);
    close(placement.verticalAnchor ? 2410-p.y-box.h/2 : p.y-box.h/2,geometry.margin);
  }
  for (const anchor of [-.1,1.1,null,NaN,Infinity,'0']) {
    const state=store.get();state.boards[date].placements[0].verticalAnchor=anchor;
    assert.throws(()=>validate(state),/纵向/);
  }
});
