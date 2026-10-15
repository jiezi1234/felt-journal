const test = require('node:test');
const assert = require('node:assert/strict');
const edit = require('../miniprogram/core/photo-edit');
const platform = require('../miniprogram/services/platform');
const { clone } = require('../miniprogram/core/store');
let definition;
global.Page = page => { definition = page; };
require('../miniprogram/pages/photo-edit/index'); delete global.Page;
const event = dataset => ({ currentTarget: { dataset } });
function fixture(t) {
  const saved = { ...platform }; t.after(() => Object.assign(platform, saved));
  let guarded, backs = 0;
  platform.unloadGuard = value => { guarded = value; }; platform.back = () => { backs++; }; platform.call = async () => ({ confirm: true });
  const page = Object.assign({}, definition, { data: { ...clone(definition.data), loading: false, ready: true }, state: edit.initial(400, 300), memory: {}, image: { width: 400, height: 300 }, setData(update) { Object.assign(this.data, update); }, draw() {} });
  return { page, guarded: () => guarded, backs: () => backs };
}
test('preset/rotation/mirror/reset update dirty state and guard; reset does not modify original', t => {
  const f = fixture(t), p = f.page; p.update(); assert.equal(f.guarded(), false);
  p.ratio(event({ ratio: 1 })); assert.equal(p.data.dimensions, '300 × 300'); assert.equal(p.data.dirty, true); assert.equal(f.guarded(), true);
  p.rotate(); p.mirror(); p.reset(); assert.equal(p.data.dirty, false); assert.equal(p.data.dimensions, '400 × 300');
  p.data.source = 'original'; p.reset(); assert.equal(p.data.dirty, true); // saving the original replaces the existing subject
});
test('moving crop survives touchend, cancel restores start, and other controls cancel an active gesture', t => {
  const { page: p } = fixture(t); p.ratio(event({ ratio: 1 })); const c = { ...p.state.crop };
  p.viewport = { scale: 1, left: 0, top: 0 };
  p.gesture = { crop: c, handle: 'move', point: { x: 100, y: 100 }, rect: { left: 0, top: 0 } };
  p.touchMove({ touches: [{ clientX: 120, clientY: 100 }] }); assert.equal(p.state.crop.x, 70); p.touchCancel(); assert.equal(p.state.crop.x, 50);
  p.gesture = { crop: c, handle: 'move', point: { x: 100, y: 100 }, rect: { left: 0, top: 0 } };
  p.touchMove({ touches: [{ clientX: 120, clientY: 100 }] }); p.touchEnd(); assert.equal(p.state.crop.x, 70);
  p.gesture = { crop: c }; p.rotate(); assert.equal(p.state.crop.y, 50); assert.equal(p.gesture, null);
});
test('saving/loading block all edits and returning can keep or discard pending changes', async t => {
  const f = fixture(t), p = f.page; p.rotate(); const state = clone(p.state);
  p.data.saving = true; p.rotate(); p.mirror(); p.reset(); p.ratio(event({ ratio: 1 })); assert.deepEqual(p.state, state);
  p.data.saving = false; p.data.loading = true; p.rotate(); assert.deepEqual(p.state, state); p.data.loading = false;
  platform.call = async () => ({ confirm: false }); await p.back(); assert.equal(f.backs(), 0);
  let cancelled = false; p.task = { cancel: async () => { cancelled = true; } }; platform.call = async () => ({ confirm: true });
  await p.back(); assert.equal(cancelled, true); assert.equal(f.backs(), 1); assert.equal(f.guarded(), false);
});
test('switching source requires confirmation only for unsaved transforms and resets through loading', async t => {
  const { page: p } = fixture(t); let selected; p.loadSource = async value => { selected = value; };
  p.rotate(); platform.call = async () => ({ confirm: false }); await p.source(event({ source: 'original' })); assert.equal(selected, undefined);
  platform.call = async () => ({ confirm: true }); await p.source(event({ source: 'original' })); assert.equal(selected, 'original');
  p.onUnload(); assert.equal(p.disposed, true);
});
