const test = require('node:test');
const assert = require('node:assert/strict');
const dates = require('../miniprogram/core/date');
const navigation = require('../miniprogram/core/journal-navigation');
const { createStore, clone, KEY } = require('../miniprogram/core/store');
const platform = require('../miniprogram/services/platform');
let definition;
global.Page = page => { definition = page; };
require('../miniprogram/pages/index/index');
delete global.Page;
const event = values => ({ currentTarget: { dataset: values } });
const photo = id => ({ originalPath: `/${id}.jpg`, subjectPath: `/${id}.png`, width: 240, height: 240, kind: 'extracted' });
function fixture(t) {
  const originalPlatform = { ...platform }, originalKey = dates.key;
  t.after(() => { Object.assign(platform, originalPlatform); dates.key = originalKey; });
  let today = '2026-10-22', fail = false;
  dates.key = () => today;
  platform.syncTab = () => {}; platform.unloadGuard = () => {}; platform.toast = () => {};
  platform.call = async () => ({ confirm: true }); platform.confirmRemovePlacement = async () => true;
  const disk = {}, store = createStore({ get: key => disk[key], set(key, value) { if (fail && key === KEY) throw new Error('disk full'); disk[key] = value; } });
  const page = { ...definition, data: clone(definition.data), store, setData(update) { Object.assign(this.data, update); }, selectComponent() { return { touchCancel() {} }; } };
  page.refresh();
  return { page, store, disk, fail(value) { fail = value; }, today(value) { today = value; } };
}
function themes(store) {
  const first = store.createTheme('a', '日常碎片'), second = store.createTheme('b', '散步收集');
  store.commit(state => { state.boards[first].createdAt = 1; state.boards[first].updatedAt = 2; state.boards[second].createdAt = 3; state.boards[second].updatedAt = 4; });
  return { first, second };
}

test('canvas header hits open the same share card in calendar and theme modes without changing the board', t => {
  const f = fixture(t), p = f.page, id = f.store.add('share', '2026-10-22', photo('share'));
  const themeId = f.store.createTheme('share', '分享测试', id); p.refresh();
  const rects = [{ left: 300, right: 344, top: 180, bottom: 224 }, null];
  p.createSelectorQuery = () => ({ select() { return this; }, boundingClientRect() { return this; }, exec(cb) { cb(rects); } });
  const tap = { detail: { start: { x: 322, y: 202 }, end: { x: 322, y: 202 } } };
  for (const mode of ['calendar', 'themes']) {
    if (mode === 'themes') { p.switchMode(); p.chooseTheme(event({ id: themeId })); }
    const before = f.disk[KEY], date = p.date;
    p.overhangTap(tap); assert.equal(p.data.shareBoardId, date); assert.equal(p.data.navigationBusy, true);
    p.overhangTap(tap); assert.equal(p.data.shareBoardId, date);
    p.closeShareCard(); assert.equal(p.data.navigationBusy, false); assert.equal(f.disk[KEY], before);
  }
});

test('header hits distinguish theme options and ignore blank space, blocked states and stale measurements', t => {
  const f = fixture(t), p = f.page; themes(f.store); p.switchMode();
  const rects = [{ left: 256, right: 300, top: 180, bottom: 224 }, { left: 300, right: 344, top: 180, bottom: 224 }];
  let complete, shares = 0, options = 0;
  p.exportToday = () => { shares++; }; p.openSelection = () => { options++; };
  p.createSelectorQuery = () => ({ select() { return this; }, boundingClientRect() { return this; }, exec(cb) { complete = cb; } });
  const tap = (x, endX = x) => p.overhangTap({ detail: { start: { x, y: 202 }, end: { x: endX, y: 202 } } });
  tap(322); complete(rects); assert.equal(options, 1);
  tap(200); complete(rects); tap(299, 302); complete(rects); assert.equal(shares, 0); assert.equal(options, 1);
  for (const key of ['journalPicker', 'drawer', 'loading', 'error', 'dragging', 'shareBoardId']) {
    tap(278); p.data[key] = true; complete(rects); p.data[key] = ''; assert.equal(shares, 0, key);
  }
  tap(278); const originalDate = p.date; p.date = 'changed'; complete(rects); p.date = originalDate;
  tap(278); p.disposed = true; complete(rects); assert.equal(shares, 0);
});
test('recent date rail crosses month/year/leap boundaries and only includes past dates', () => {
  const state = { boards: {} };
  assert.deepEqual(navigation.recent(state, '2024-03-01', '2024-03-01').map(d => d.date), ['2024-02-26','2024-02-27','2024-02-28','2024-02-29','2024-03-01']);
  assert.equal(navigation.recent(state, '2026-12-31', '2027-01-03')[2].date, '2026-12-31');
});
test('reading dates, opening pickers and visiting empty theme mode never creates empty boards', t => {
  const { page: p, store } = fixture(t), before = store.get();
  p.chooseDate(event({ date: '2024-02-29' })); assert.equal(p.date, '2024-02-29'); assert.equal(p.data.canEdit, true);
  p.openJournalPicker(); assert.equal(p.data.journalPicker, 'calendar');
  p.chooseDate(event({ date: '2999-01-01' })); assert.equal(p.date, '2024-02-29');
  p.closeJournalPicker(); p.switchMode(); assert.equal(p.data.mode, 'themes'); assert.equal(p.date, '');
  p.openJournalPicker(); assert.equal(p.data.journalPicker, 'themes'); p.closeJournalPicker();
  p.switchMode(); assert.equal(p.date, '2024-02-29'); assert.deepEqual(store.get(), before);
});
test('calendar and theme modes restore independent selections and first theme entry uses the remembered board', t => {
  const { page: p, store } = fixture(t), ids = themes(store);
  store.rememberTheme(ids.first);
  p.chooseDate(event({ date: '2026-10-20' })); const before = store.get();
  p.switchMode(); assert.equal(p.date, ids.first);
  p.chooseTheme(event({ id: ids.second })); p.switchMode(); assert.equal(p.date, '2026-10-20');
  p.switchMode(); assert.equal(p.date, ids.second); assert.equal(p.data.themeRail.find(t => t.id === ids.second).title, '散步收集');
  assert.deepEqual(store.get(), before);
});
test('theme thumbnail follows latest placement time, not image age, z-order or layout edits', t => {
  const { page: p, store } = fixture(t), { first } = themes(store);
  const a = store.add('old', '2020-01-01', photo('old')), b = store.add('new', '2026-10-22', photo('new'));
  store.place(b, first); store.place(a, first);
  store.commit(s => { const ps = s.boards[first].placements; ps[0].createdAt = 1; ps[0].z = 99; ps[1].createdAt = 2; ps[1].z = 1; });
  p.switchMode(); p.chooseTheme(event({ id: first }));
  assert.equal(p.data.themeRail.find(t => t.id === first).latestId, a);
  store.replace('changed', a, photo('changed')); p.refresh();
  assert.equal(p.data.themeRail.find(t => t.id === first).latestPath, '/changed.png');
  store.unplace(a, first); p.refresh(); assert.equal(p.data.themeRail.find(t => t.id === first).latestId, b);
  store.unplace(b, first); p.refresh(); assert.equal(p.data.themeRail.find(t => t.id === first).latestPath, '');
});

test('calendar and theme pickers preview two recent board objects without duplicates or invented placeholders',t=>{
  const {store}=fixture(t),{first}=themes(store);
  const ids=['a','b','c'].map(id=>store.add(id,'2026-10-22',photo(id)));
  ids.forEach(id=>store.place(id,first));
  store.commit(state=>{for(const id of ['2026-10-22',first])state.boards[id].placements.forEach((p,i)=>{p.createdAt=i+1;p.z=3-i;});});
  assert.deepEqual(navigation.themes(store.get()).find(b=>b.id===first).images.map(p=>p.id),[ids[2],ids[1]]);
  assert.deepEqual(navigation.month(store.get(),2026,10,'2026-10-22').find(d=>d.date==='2026-10-22').images.map(p=>p.id),[ids[2],ids[1]]);
  store.unplace(ids[2],first);store.unplace(ids[1],first);
  assert.equal(navigation.themes(store.get()).find(b=>b.id===first).images.length,1);
  store.unplace(ids[0],first);assert.deepEqual(navigation.themes(store.get()).find(b=>b.id===first).images,[]);
});

test('picker exit stays mounted until the animation ends and rejects duplicate selections',t=>{
  const {page:p,store}=fixture(t);themes(store);p.openJournalPicker();
  const oldWx=global.wx;global.wx={};t.after(()=>{global.wx=oldWx;});t.mock.timers.enable({apis:['setTimeout']});
  p.closeJournalPicker();assert.equal(p.data.pickerClosing,true);assert.equal(p.data.journalPicker,'calendar');
  p.switchMode();p.chooseDate(event({date:'2026-10-20'}));assert.equal(p.data.mode,'calendar');assert.equal(p.date,'2026-10-22');
  t.mock.timers.tick(179);assert.equal(p.data.journalPicker,'calendar');t.mock.timers.tick(1);
  assert.equal(p.data.journalPicker,'');assert.equal(p.data.pickerClosing,false);
});

test('more waits for the decoded board before opening and closing cancels a pending opening',async t=>{
  const {page:p}=fixture(t);let ready;
  p.selectComponent=()=>({touchCancel(){},prepareOverlay:()=>new Promise(resolve=>{ready=resolve;})});
  const opening=p.openJournalPicker();assert.equal(p.data.pickerPreparing,true);assert.equal(p.data.journalPicker,'');
  p.switchMode();assert.equal(p.data.mode,'calendar');
  ready(true);await opening;assert.equal(p.data.journalPicker,'calendar');assert.equal(p.data.pickerPreparing,false);
  p.closeJournalPicker();const cancelled=p.openJournalPicker();p.closeJournalPicker();ready(true);await cancelled;
  assert.equal(p.data.journalPicker,'');assert.equal(p.data.pickerPreparing,false);assert.equal(p.data.navigationBusy,false);
});

test('failed or stalled board preparation still opens a picker with native occlusion enabled',async t=>{
  const {page:p}=fixture(t);t.mock.timers.enable({apis:['setTimeout']});
  p.selectComponent=()=>({touchCancel(){},prepareOverlay:()=>Promise.reject(Error('capture failed'))});
  await p.openJournalPicker();assert.equal(p.data.journalPicker,'calendar');p.closeJournalPicker();
  p.selectComponent=()=>({touchCancel(){},prepareOverlay:()=>new Promise(()=>{})});
  p.openJournalPicker();t.mock.timers.tick(900);assert.equal(p.data.journalPicker,'calendar');assert.equal(p.data.pickerPreparing,false);
});
test('busy operations and failed saves cannot switch the editor to a different board', t => {
  const f = fixture(t), p = f.page; themes(f.store);
  f.store.add('one', '2026-10-22', photo('one')); p.refresh(); p.edit();
  f.fail(true); p.draft.color = p.data.colors[1].value; p.changed(); const draft = clone(p.draft);
  p.switchMode(); assert.equal(p.data.mode, 'calendar'); assert.deepEqual(p.draft, draft); assert.equal(p.dirty, true);
  f.fail(false); p.retrySave();
  for (const field of ['editorOpen','placing','memoryCardId','shareBoardId','task','recovering','formOpen','working','dragging']) {
    p.setData({ [field]: true }); p.switchMode(); p.chooseDate(event({ date: '2026-10-20' }));
    assert.equal(p.date, '2026-10-22', field); assert.equal(p.data.mode, 'calendar', field); p.setData({ [field]: false });
  }
  p.switchMode(); assert.equal(p.data.mode, 'themes');
});
test('adding from the theme library updates the thumbnail and releases the navigation lock', async t => {
  const { page: p, store } = fixture(t), { first } = themes(store), id = store.add('library', '2020-01-01', photo('library'));
  p.switchMode(); p.chooseTheme(event({ id: first })); await p.library();
  p.toggleLibrary(event({ id })); p.addLibrary();
  assert.equal(p.data.count, 1); assert.equal(p.data.themeRail.find(t => t.id === first).latestId, id); assert.equal(p.data.navigationBusy, false);
  p.editItem({ detail: { id } }); await p.remove(); assert.equal(p.data.count, 0); assert.equal(p.data.navigationBusy, false);
  assert.ok(store.get().memories[id]); p.switchMode(); assert.equal(p.data.mode, 'calendar');
});
test('calendar selection stays pinned across midnight; following today advances after a photo card closes', t => {
  const f = fixture(t), p = f.page;
  p.primary(); f.today('2026-10-23'); p.refresh(); assert.equal(p.date, '2026-10-22');
  p.closeEditor(); assert.equal(p.date, '2026-10-23');
  p.chooseDate(event({ date: '2026-10-20' })); f.today('2026-10-24'); p.refresh(); assert.equal(p.date, '2026-10-20');
  themes(f.store); p.returnToday(); p.switchMode(); const selectedTheme = p.date;
  f.today('2026-10-25'); p.refresh(); assert.equal(p.date, selectedTheme);
  p.switchMode(); assert.equal(p.date, '2026-10-25');
});
test('theme creation, renaming and deletion stay inside the selected mode', async t => {
  const { page: p, store } = fixture(t); p.switchMode();
  p.createJournalTheme(); assert.equal(p.data.formOpen, true); p.input({ detail: { value: '新的小事' } }); await p.save();
  const id = p.date; assert.equal(p.data.mode, 'themes'); assert.equal(store.board(id).title, '新的小事');
  p.closeDrawer(); p.rename(); p.input({ detail: { value: '慢慢收集' } }); await p.save();
  assert.equal(p.data.themeRail[0].title, '慢慢收集');
  await p.removeTheme(); assert.equal(p.date, ''); assert.equal(p.data.error, ''); p.switchMode(); assert.equal(p.date, '2026-10-22');
});
test('theme photo handoff closes its owned processing panel and releases navigation after landing', t => {
  const { page: p, store } = fixture(t), { first } = themes(store);
  p.switchMode(); p.chooseTheme(event({ id: first }));
  const id = store.add('photo_handoff', '2026-10-22', photo('handoff'), first);
  p.photoDone(id); p.photoTask = { committed: true }; p.setData({ task: { state: 'done' }, placing: { id, token: 3 }, navigationBusy: true });
  p.stickerLifted({ detail: { token: 3 } }); assert.equal(p.photoTask, null); assert.equal(p.data.task, null); assert.ok(p.data.placing);
  p.stickerLanded(); assert.equal(p.data.placing, null); assert.equal(p.data.navigationBusy, false);
  p.switchMode(); assert.equal(p.data.mode, 'calendar'); assert.ok(store.board(first).placements.some(p=>p.memoryId===id));
});
