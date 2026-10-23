const test = require('node:test');
const assert = require('node:assert/strict');
const { createCanvas } = require('@napi-rs/canvas');
const guide = require('../miniprogram/core/board-guide');
const actions = require('../miniprogram/core/board-actions');
const renderer = require('../miniprogram/core/renderer');
const config = require('../miniprogram/core/config');

test('empty guidance leaves the add target clear and disappears for content or overlays', () => {
  for (const width of [268,320,378,508]) for (const height of [width*2/3,400,516,700]) {
    const state = {interactive:true,floatingControls:{label:'添加记忆',offsetY:42},bottomInset:34};
    const buttons = actions.layout(width,height,state), add = buttons[0];
    const g = guide.layout({items:[]},width,height,buttons);
    assert.ok(g && g.y-70*g.scale>0 && g.y+85*g.scale<add.y-10,'Artwork and copy fit above the button');
    assert.ok(g.arrowEnd < add.y && g.x === width/2);
    assert.equal(guide.layout({items:[{memoryId:'one'}]},width,height,buttons),null);
    for (const hidden of [{covered:true},{dragging:true},{landingId:'one'},{interactive:false}]) {
      assert.equal(guide.layout({items:[]},width,height,actions.layout(width,height,{...state,...hidden})),null);
    }
    assert.equal(guide.layout({items:[]},width,height,actions.layout(width,height,{...state,floatingControls:{disabled:true}})),null);
  }
});

test('live guidance paints separately and never contaminates a board export', () => {
  const width=378,height=516,dimensions={...config.board,height:height/width*1500};
  const canvas=createCanvas(378,589),ctx=canvas.getContext('2d'),model={color:'#D9CBAF',items:[]};
  const render=()=>{ctx.setTransform(width/1500,0,0,width/1500,0,config.board.overhang*width/1500);renderer.paint(ctx,model,{},'',dimensions);};
  render(); const exported=canvas.toBuffer('image/png');
  const buttons=actions.layout(width,height,{interactive:true,floatingControls:{label:'添加记忆',offsetY:42}});
  guide.paint(ctx,guide.layout(model,width,height,buttons),width);
  assert.notDeepEqual(canvas.toBuffer('image/png'),exported,'Live canvas contains the hand-drawn guidance');
  render(); assert.deepEqual(canvas.toBuffer('image/png'),exported,'Export uses only the material and memories');
});
