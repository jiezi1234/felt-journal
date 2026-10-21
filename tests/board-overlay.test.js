const test = require('node:test');
const assert = require('node:assert/strict');
const renderer = require('../miniprogram/core/renderer');
let definition;
global.Component = value => { definition = value; };
require('../miniprogram/components/felt-board/index');
delete global.Component;

test('covered boards retain a snapshot but ignore callbacks after reopening or detaching', async t => {
  const originalWx = global.wx, originalRenderer = { ...renderer }, requests = [];
  t.after(() => { global.wx = originalWx; Object.assign(renderer, originalRenderer); });
  global.wx = { canvasToTempFilePath: request => requests.push(request) };
  renderer.loadImages = async () => ({}); renderer.paint = () => {}; renderer.paintControls = () => {};
  const board = Object.assign({}, definition.methods, {
    data: { model: { items: [] }, covered: true, editable: false, snapshot: '', selected: '' },
    canvas: { width: 600, height: 400, getContext: () => ({ setTransform() {} }) }, screenWidth: 300,
    setData(value) { Object.assign(this.data, value); }
  });
  await board.refresh(); assert.equal(requests.length, 1);
  board.data.covered = false; await board.refresh(); requests[0].success({ tempFilePath: '/late.png' });
  assert.equal(board.data.snapshot, '', 'Returning to live editing must ignore a late snapshot');
  board.data.covered = true; await board.refresh(); requests[1].success({ tempFilePath: '/current.png' });
  assert.equal(board.data.snapshot, '/current.png');
  await board.refresh(); board.dead = true; requests[2].success({ tempFilePath: '/detached.png' });
  assert.equal(board.data.snapshot, '/current.png', 'Detached cards must not update their UI');
});

test('covered boards do not respond to pointer input underneath a card', () => {
  const board = Object.assign({}, definition.methods, { data: { covered: true, interactive: true, model: { items: [] } },
    createSelectorQuery() { throw new Error('Background board must not start a gesture'); } });
  board.touchStart({ touches: [{ clientX: 10, clientY: 10 }] }); assert.equal(board.gesture, null);
});

test('canvas headroom does not offset native touches or viewport-coordinate touches', () => {
  const board={...definition.methods,data:{topSpace:18},screenWidth:430,rect:{left:12,top:50}};
  assert.deepEqual(board.localPoint({x:100,y:118}),{x:100,y:100});
  assert.deepEqual(board.localPoint({clientX:112,clientY:150}),{x:100,y:100});
  assert.deepEqual(board.point({x:100,y:118}),board.point({clientX:112,clientY:150}));
});

test('fit and tall boards reserve headroom inside the available stage', t => {
  const previous=global.wx;t.after(()=>{global.wx=previous;});global.wx={getSystemInfoSync:()=>({pixelRatio:2})};
  for(const layout of ['fit','tall','']) {
    const canvas={},rect={width:360,height:600};
    const board={...definition.methods,data:{...definition.data,layout},refresh(){},
      setData(data,done){Object.assign(this.data,data);done();},
      createSelectorQuery(){return {select(){return this;},fields(){return this;},boundingClientRect(){return this;},exec(fn){fn([{node:canvas},rect]);}};}};
    board.measure();const d=board.data;
    assert.ok(d.topSpace>0);assert.equal(d.canvasHeight,d.height+d.topSpace);assert.ok(d.canvasHeight<=rect.height);
    assert.equal(canvas.height,Math.round(d.canvasHeight*2));assert.equal(board.exportViewport().height,board.dimensions.height);
  }
});

test('a simple editable sticker tap opens its card but dragging and long press do not open it twice', () => {
  const events = [], item = { id: 'placement', memoryId: 'memory' };
  const board = { ...definition.methods, data: { editable: true, interactive: true }, refresh() {}, triggerEvent(name, detail) { events.push({ name, detail }); } };
  board.gesture = { item }; board.touchEnd(); assert.deepEqual(events, [{ name: 'memory', detail: { id: 'memory' } }]);
  events.length = 0; board.gesture = { item, moved: true, next: { ...item, x: 40 } }; board.touchEnd(); assert.deepEqual(events.map(e => e.name), ['change']);
  events.length = 0; board.gesture = { item, long: true }; board.touchEnd(); assert.deepEqual(events, []);
  board.gesture = {}; board.touchEnd(); assert.deepEqual(events, [{ name: 'select', detail: { id: '' } }]);
});

function gestureFixture(t, data = {}, delayed = false) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const B = require('../miniprogram/core/config').board;
  const item = require('../miniprogram/core/geometry').create('memory', 400, 300, 0, 1), events = [];
  const rect = { left: 20, top: 40 }, screenWidth = 360;
  const touch = { clientX: rect.left + (item.x + B.inset) * screenWidth / B.width, clientY: rect.top + (item.y + B.inset) * screenWidth / B.width };
  let callback;
  const board = { ...definition.methods, data: { model: { items: [item] }, interactive: true, canEdit: true, editable: false, selected: '', ...data }, screenWidth,
    refresh() {}, triggerEvent(name, detail) {
      events.push({ name, detail });
      if (name === 'edititem') Object.assign(this.data, { editable: true, selected: detail.id });
    },
    createSelectorQuery() { return { select() { return this; }, boundingClientRect(cb) { callback = cb; return this; }, exec() { if (!delayed) callback(rect); } }; }
  };
  return { board, item, events, start: () => board.touchStart({ touches: [touch] }), measure: () => callback(rect),
    move: dx => board.touchMove({ touches: [{ ...touch, clientX: touch.clientX + dx }] }) };
}

test('tapping an object opens its card without selecting it in browse or edit mode', t => {
  const f = gestureFixture(t);
  for (const editable of [false, true]) {
    f.board.data.editable = editable; f.events.length = 0;
    f.start(); assert.deepEqual(f.events, []); t.mock.timers.tick(300); f.board.touchEnd(); t.mock.timers.tick(1000);
    assert.deepEqual(f.events, [{ name: 'memory', detail: { id: f.item.memoryId } }]);
    assert.equal(f.board.data.selected, '');
  }
});

test('holding an object enters editing once; releasing does not open its card', t => {
  const f = gestureFixture(t); f.start(); t.mock.timers.tick(649); assert.deepEqual(f.events, []);
  t.mock.timers.tick(1); assert.equal(f.board.data.editable, true); assert.equal(f.board.data.selected, f.item.memoryId);
  f.board.touchEnd(); t.mock.timers.tick(1000);
  assert.deepEqual(f.events, [{ name: 'edititem', detail: { id: f.item.memoryId } }]);
});

test('movement cancels long press and cannot move an unselected object', t => {
  const f = gestureFixture(t, { editable: true }); f.start(); f.move(20); t.mock.timers.tick(1000); f.board.touchEnd();
  assert.deepEqual(f.events, []); assert.equal(f.board.dragModel, null);
});

test('rapid movement paints once per frame and saves the final release position', t => {
  const f = gestureFixture(t), p = f.board, frames = new Map(); let id = 0, paints = 0;
  p.canvas = { requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(key) { frames.delete(key); } };
  p.refresh = () => { paints++; };
  f.start(); t.mock.timers.tick(650); f.events.length = 0;
  for (const x of [10, 20, 30]) f.move(x);
  assert.equal(frames.size, 1); assert.equal(paints, 0); assert.deepEqual(f.events, []);
  const latest = p.dragModel.items[0].x;
  const draw = frames.values().next().value; frames.clear(); draw(); assert.equal(paints, 1);
  const release = { ...p.gesture.touch, clientX: p.gesture.touch.clientX + 50 };
  p.touchEnd({ changedTouches: [release] });
  assert.equal(f.events.length, 1); assert.ok(f.events[0].detail.placement.x > latest);
  assert.equal(frames.size, 0); assert.equal(p.dragModel, null);
  f.start(); f.move(20); assert.equal(frames.size, 1); p.touchCancel();
  assert.equal(frames.size, 0); assert.equal(f.events.length, 1);
});

test('a replacement finger cancels the pending gesture instead of saving a jump', t => {
  const f = gestureFixture(t); f.start(); t.mock.timers.tick(650); f.events.length = 0;
  f.board.gesture.touch.identifier = 1;
  f.board.touchMove({ touches: [{ identifier: 2, clientX: 300, clientY: 300 }] }); f.board.touchEnd();
  assert.equal(f.board.gesture, null); assert.deepEqual(f.events, []);
});

test('dragging works after long press and on a subsequent gesture of the selected object', t => {
  const f = gestureFixture(t); f.start(); t.mock.timers.tick(650); f.move(20); f.board.touchEnd();
  assert.deepEqual(f.events.map(e => e.name), ['edititem', 'change']); assert.ok(f.events[1].detail.placement.x > f.item.x);
  f.events.length = 0; f.start(); f.move(-20); t.mock.timers.tick(1000); f.board.touchEnd();
  assert.deepEqual(f.events.map(e => e.name), ['change']); assert.ok(f.events[0].detail.placement.x < f.item.x);
});

test('cancellation, covering, backgrounding, multitouch and detaching suppress pending long presses', t => {
  const f = gestureFixture(t);
  const cancel = [() => f.board.touchCancel(), () => { f.board.data.covered = true; definition.observers['covered, interactive'].call(f.board); },
    () => definition.pageLifetimes.hide.call(f.board), () => f.board.touchMove({ touches: [{}, {}] }), () => definition.lifetimes.detached.call(f.board)];
  for (const stop of cancel) {
    f.board.dead = false; f.board.data.covered = false; f.start(); stop(); t.mock.timers.tick(1000); f.board.touchEnd(); assert.deepEqual(f.events, []);
  }
});

test('delayed measurements cannot revive canceled or already moving presses', t => {
  const f = gestureFixture(t, {}, true);
  f.start(); f.move(20); f.measure(); t.mock.timers.tick(1000); f.board.touchEnd(); assert.deepEqual(f.events, []);
  f.start(); f.board.touchCancel(); f.measure(); t.mock.timers.tick(1000); assert.deepEqual(f.events, []); assert.equal(f.board.gesture, null);
});

test('a fast tap waits for hit testing instead of being mistaken for empty board space', t => {
  const f = gestureFixture(t, {}, true); f.start(); f.board.touchEnd(); assert.deepEqual(f.events, []);
  f.measure(); t.mock.timers.tick(1000); assert.deepEqual(f.events, [{ name: 'memory', detail: { id: f.item.memoryId } }]);
});

test('read-only boards allow tap viewing but do not edit or open a card after holding', t => {
  const f = gestureFixture(t, { canEdit: false }); f.start(); t.mock.timers.tick(1000); f.board.touchEnd(); assert.deepEqual(f.events, []);
  f.start(); f.board.touchEnd(); assert.deepEqual(f.events.map(e => e.name), ['memory']); assert.equal(f.board.data.editable, false);
});

test('delete control requests removal of the selection without transforming or opening a card', t => {
  const f = gestureFixture(t), p = f.board, tap = op => p.transform({ currentTarget: { dataset: { op } } });
  f.start(); t.mock.timers.tick(650); p.touchEnd(); f.events.length = 0;
  tap('remove'); assert.deepEqual(f.events, [{ name: 'remove', detail: { id: f.item.memoryId } }]);
  f.events.length = 0;
  for (const [key, value] of Object.entries({ covered: true, interactive: false, canEdit: false, editable: false, selected: '', landingId: 'in-flight' })) {
    const original = p.data[key]; p.data[key] = value; tap('remove'); p.data[key] = original;
  }
  p.dead = true; tap('remove'); p.dead = false;
  assert.deepEqual(f.events, []);
  tap('rotate'); tap('resize'); assert.deepEqual(f.events, [], 'Size and angle require a drag');
});

function controlFixture(t, delayed = false) {
  const f = gestureFixture(t, { editable: true, selected: 'memory', height: 240 }, delayed);
  const geometry = require('../miniprogram/core/geometry');
  f.board.data.handles = geometry.handles(f.item, f.board.screenWidth, 600);
  f.at = (op, canvas = false) => {
    const h = f.board.data.handles.find(h => h.op === op);
    return canvas ? { x: h.x, y: h.y } : { clientX: h.x + 20, clientY: h.y + 40 };
  };
  f.begin = touch => f.board.touchStart({ touches: [touch] });
  f.end = touch => f.board.touchEnd({ changedTouches: [touch] });
  return f;
}

test('canvas controls preview continuous size and angle, then commit once on fit and tall boards', t => {
  const f = controlFixture(t), geometry = require('../miniprogram/core/geometry'), viewport = require('../miniprogram/core/board-viewport');
  for (const height of [240, 600]) for (const canvas of [false, true]) {
    Object.assign(f.board.data, { height, layout: height === 600 ? 'tall' : '' });
    const display = viewport.present(f.board.data.model, 360, height).model;
    f.board.displayModel = display;
    f.board.data.handles = geometry.handles(display.items[0], 360, height);
    const center = { x: (display.items[0].x + 45) * 360 / 1500, y: (display.items[0].y + 45) * 360 / 1500 };
    for (const op of ['rotate', 'resize']) {
      f.events.length = 0;
      const touch = f.at(op, canvas), start = f.board.data.handles.find(h => h.op === op);
      const at = fraction => {
        const angle = 23.7 * fraction * Math.PI / 180, ratio = 1 + .2 * fraction;
        const dx = start.x - center.x, dy = start.y - center.y;
        const x = center.x + (op === 'resize' ? dx * ratio : dx * Math.cos(angle) - dy * Math.sin(angle));
        const y = center.y + (op === 'resize' ? dy * ratio : dx * Math.sin(angle) + dy * Math.cos(angle));
        return canvas ? { x, y } : { clientX: x + 20, clientY: y + 40 };
      };
      f.begin(touch); t.mock.timers.tick(800);
      for (const fraction of [.25, .5, 1]) {
        f.board.touchMove({ touches: [at(fraction)] });
        const preview = f.board.dragModel.items[0];
        assert.ok(Math.abs((op === 'resize' ? preview.width : preview.angle) - (op === 'resize' ? f.item.width * (1 + .2 * fraction) : 23.7 * fraction)) < .001);
        assert.equal(f.board.data.model.items[0], f.item); assert.deepEqual(f.events, [], 'No writes before release');
      }
      f.end(at(1)); f.end(at(1));
      assert.deepEqual(f.events.map(e => e.name), ['change']);
      assert.equal(f.board.dragModel, null);
      assert.equal(f.events[0].detail.placement.x, f.item.x); assert.equal(f.events[0].detail.placement.y, f.item.y);
    }
  }
});

test('tall board drags reach both felt edges through native and viewport touches with clamp headroom', t => {
  const viewport=require('../miniprogram/core/board-viewport'),geometry=require('../miniprogram/core/geometry'),B=require('../miniprogram/core/config').board;
  const f=controlFixture(t),b=f.board,s=360/B.width;
  for (const native of [false,true]) {
    Object.assign(b.data,{model:{items:[f.item]},layout:'tall',height:600,topSpace:B.overhang*s});
    const touch=(x,y)=>native?{x,y:y+b.data.topSpace}:{clientX:x+20,clientY:y+40};
    for (const edge of [0,1]) {
      b.displayModel=viewport.present(b.data.model,360,600).model;
      const item=b.displayModel.items[0];b.data.handles=geometry.handles(item,360,600);
      const start=touch((B.inset+item.x)*s,(B.inset+item.y)*s),end=touch((B.inset+item.x)*s,edge?600:0);
      f.events.length=0;b.touchStart({touches:[start]});b.touchMove({touches:[end]});
      assert.equal(f.events.length,0);const preview=b.dragModel.items[0],shown=viewport.toDisplay(preview,360,600),box=geometry.extent(shown);
      const gap=edge?2410-shown.y-box.h/2:shown.y-box.h/2;
      assert.ok(Math.abs(gap-geometry.margin)<1e-7);
      b.touchEnd({changedTouches:[end]});assert.equal(f.events.length,1);
      assert.equal(f.events[0].name,'change');assert.deepEqual(f.events[0].detail.placement,preview);
      b.data.model={items:[preview]};
    }
  }
});

test('resize and rotation use the displayed center after moving a sticker into an edge band', t => {
  const viewport=require('../miniprogram/core/board-viewport'),geometry=require('../miniprogram/core/geometry');
  const f=controlFixture(t),b=f.board,s=360/1500;
  Object.assign(b.data,{layout:'tall',height:600});
  for (const y of [-1e6,500,1e6]) for (const op of ['resize','rotate']) {
    const item=viewport.toStored({...f.item,width:280,height:220,angle:17,y},360,600);
    b.data.model={items:[item]};b.displayModel=viewport.present(b.data.model,360,600).model;
    const shown=b.displayModel.items[0];b.data.handles=geometry.handles(shown,360,600);
    const center={x:(shown.x+45)*s,y:(shown.y+45)*s},h=b.data.handles.find(h=>h.op===op);
    const dx=h.x-center.x,dy=h.y-center.y,a=23.7*Math.PI/180;
    const x=center.x+(op==='resize'?dx*1.2:dx*Math.cos(a)-dy*Math.sin(a));
    const targetY=center.y+(op==='resize'?dy*1.2:dx*Math.sin(a)+dy*Math.cos(a));
    const end={clientX:x+20,clientY:targetY+40};f.events.length=0;
    b.controlStart({currentTarget:{dataset:{op}},touches:[f.at(op)]});b.touchMove({touches:[end]});
    const next=b.dragModel.items[0],actual=viewport.toDisplay(next,360,600);
    const expected=geometry.fit({...shown,width:shown.width*(op==='resize'?1.2:1),height:shown.height*(op==='resize'?1.2:1),angle:shown.angle+(op==='rotate'?23.7:0)},{width:1500,height:2500});
    for(const key of ['x','y','width','height','angle'])assert.ok(Math.abs(actual[key]-expected[key])<1e-7,`${op} ${key} follows the visible center`);
    b.touchEnd({changedTouches:[end]});assert.equal(f.events.length,1);assert.equal(f.events[0].name,'change');
  }
});

test('control touches cancel on movement, cancellation, multitouch, selection changes and overlays', t => {
  const f = controlFixture(t), touch = f.at('remove', true);
  const cancel = [
    () => f.board.touchMove({ touches: [{ x: touch.x + 20, y: touch.y }] }),
    () => f.board.touchCancel(),
    () => f.board.touchMove({ touches: [touch, touch] }),
    () => { f.board.data.selected = 'other'; },
    () => { f.board.data.covered = true; },
    () => { f.board.data.landingId = 'flying'; }
  ];
  for (const action of cancel) {
    Object.assign(f.board.data, { selected: 'memory', covered: false, landingId: '' });
    f.begin(touch); action(); f.end(touch);
    assert.deepEqual(f.events, []);
  }
  f.board.data.landingId = ''; f.begin(touch);
  f.end({ x: touch.x + 30, y: touch.y }); assert.deepEqual(f.events, [], 'Release outside cancels even if no move event arrives');
});

test('delayed measurement preserves control moves and fast taps never resize, open or deselect', t => {
  const f = controlFixture(t, true), touch = f.at('resize', true);
  f.begin(touch); f.end(touch); assert.deepEqual(f.events, []);
  f.measure(); assert.deepEqual(f.events, []);
  const end = { x: touch.x + 20, y: touch.y + 20 };
  f.begin(touch); f.board.touchMove({ touches: [end] }); f.end(end); f.measure();
  assert.deepEqual(f.events.map(e => e.name), ['change']); assert.ok(f.events[0].detail.placement.width > f.item.width);
});

test('native canvas x/y also supports long press, drag and movement cancellation', t => {
  const f = gestureFixture(t), B = require('../miniprogram/core/config').board;
  const touch = { x: (f.item.x + B.inset) * 360 / B.width, y: (f.item.y + B.inset) * 360 / B.width };
  f.board.touchStart({ touches: [touch] }); t.mock.timers.tick(650);
  f.board.touchMove({ touches: [{ x: touch.x + 20, y: touch.y }] }); f.board.touchEnd();
  assert.deepEqual(f.events.map(e => e.name), ['edititem', 'change']);
  assert.ok(f.events[1].detail.placement.x > f.item.x);
  f.events.length = 0; f.board.data.selected = '';
  f.board.touchStart({ touches: [touch] }); f.board.touchMove({ touches: [{ x: touch.x + 20, y: touch.y }] });
  t.mock.timers.tick(1000); f.board.touchEnd(); assert.deepEqual(f.events, []);
});

test('overlay controls drag beyond their hit target and ignore synthetic taps after release', t => {
  const f = controlFixture(t);
  for (const op of ['resize', 'rotate']) {
    const touch = f.at(op);
    const e = { currentTarget: { dataset: { op } }, touches: [touch], changedTouches: [touch] };
    f.events.length = 0;
    f.board.controlStart(e);
    assert.equal(f.board.gesture.button, true);
    const end = { clientX: touch.clientX + 40, clientY: touch.clientY + 50 };
    f.board.touchMove({ touches: [end] }); assert.ok(f.board.dragModel); assert.deepEqual(f.events, []);
    f.end(end); assert.deepEqual(f.events.map(e => e.name), ['change']);
    f.board.controlTap(e); f.board.controlTap(e); assert.equal(f.events.length, 1);
    f.board.controlStart(e); f.board.touchEnd(e); f.board.controlTap(e);
    assert.equal(f.events.length, 1, 'Tapping a drag control does not transform');
  }
});

test('overlay tolerates small finger drift but cancels sliding, touchcancel, multitouch and changed selection', t => {
  const f = controlFixture(t), touch = { clientX: 150, clientY: 200 };
  const e = { currentTarget: { dataset: { op: 'remove' } }, touches: [touch], changedTouches: [touch] };
  f.board.controlStart(e);
  const drift = { clientX: 158, clientY: 202 };
  f.board.touchMove({ touches: [drift] }); f.board.touchEnd({ changedTouches: [drift] });
  assert.deepEqual(f.events.map(e => e.name), ['remove']); f.events.length = 0;
  for (const cancel of [
    () => f.board.touchMove({ touches: [{ clientX: 175, clientY: 200 }] }),
    () => f.board.touchCancel(),
    () => f.board.touchMove({ touches: [touch, touch] }),
    () => { f.board.data.selected = 'another'; },
    () => { f.board.data.covered = true; }
  ]) {
    Object.assign(f.board.data, { selected: 'memory', covered: false });
    f.board.controlStart(e); cancel(); f.board.touchEnd(e); f.board.controlTap(e);
    assert.deepEqual(f.events, []);
  }
});

test('delete retains tap accessibility and disabled overlay controls do not act', t => {
  const f = controlFixture(t), e = { currentTarget: { dataset: { op: 'remove' } }, touches: [{ clientX: 150, clientY: 200 }] };
  f.board.controlTap(e); assert.deepEqual(f.events, [{ name: 'remove', detail: { id: 'memory' } }]); f.events.length = 0;
  for (const [key, value] of Object.entries({ covered: true, interactive: false, canEdit: false, editable: false, selected: '', landingId: 'in-flight' })) {
    const old = f.board.data[key]; f.board.data[key] = value;
    f.board.controlStart(e); f.board.touchEnd(); f.board.controlTap(e);
    f.board.data[key] = old;
  }
  assert.deepEqual(f.events, []);
});

test('cancelled drags discard previews; changing selection and leaving edit mode never save', t => {
  const f = controlFixture(t), touch = f.at('resize', true), end = { x: touch.x + 25, y: touch.y + 20 };
  for (const cancel of [() => f.board.touchCancel(), () => definition.pageLifetimes.hide.call(f.board),
    () => f.board.touchMove({ touches: [end, end] }), () => { f.board.data.selected = 'other'; },
    () => { f.board.data.editable = false; }, () => { f.board.data.covered = true; },
    () => { f.board.data.landingId = 'flying'; }]) {
    Object.assign(f.board.data, { selected: 'memory', editable: true, covered: false, landingId: '' });
    f.begin(touch); f.board.touchMove({ touches: [end] }); assert.ok(f.board.dragModel);
    cancel(); f.end(end); assert.deepEqual(f.events, []); assert.equal(f.board.dragModel, null);
  }
});

test('delete fires once for canvas or overlay and a following tap never duplicates it', t => {
  const f = controlFixture(t), touch = f.at('remove', true);
  const e = { currentTarget: { dataset: { op: 'remove' } }, touches: [touch], changedTouches: [touch] };
  for (const overlay of [false, true]) {
    f.events.length = 0;
    if (overlay) f.board.controlStart(e); else f.begin(touch);
    f.end(touch); f.board.controlTap(e);
    assert.deepEqual(f.events, [{ name: 'remove', detail: { id: 'memory' } }]);
  }
});
