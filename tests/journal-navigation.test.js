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
  const page = { ...definition, data: clone(definition.data), store, setData(update, done) { Object.assign(this.data, update); if(done)done(); }, selectComponent() { return { touchCancel() {} }; } };
  t.after(()=>page.clearModeSwitchTimer());
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

test('bookmark changes the header and retains each mode selection, but cannot switch through a modal or failed save', t => {
  const {page:p,store}=fixture(t);themes(store);
  p.chooseDate(event({date:'2026-10-20'}));assert.equal(p.data.headerTitle,'10月20日');
  p.floatingAction({detail:{action:'mode'}});assert.equal(p.data.mode,'calendar');assert.equal(p.data.modeSwitchExpanded,true);
  p.floatingAction({detail:{action:'mode'}});assert.equal(p.data.mode,'themes');assert.equal(p.data.headerTitle,'我的收藏');
  assert.equal(p.data.modeSwitchExpanded,true);
  p.openJournalPicker();p.floatingAction({detail:{action:'mode'}});assert.equal(p.data.mode,'themes');p.closeJournalPicker();
  p.data.saveError='磁盘已满';p.floatingAction({detail:{action:'mode'}});assert.equal(p.data.mode,'themes');p.data.saveError='';
  p.floatingAction({detail:{action:'mode'}});assert.equal(p.data.mode,'themes');
  p.floatingAction({detail:{action:'mode'}});assert.equal(p.date,'2026-10-20');assert.equal(p.data.headerTitle,'10月20日');
});
test('expanding or dismissing the bookmark never edits, saves or changes the selected board',t=>{
  const {page:p,store}=fixture(t);themes(store);p.data.editable=true;p.data.selected='selected';p.dirty=true;
  const before=store.get(),date=p.date;let captures=0,cancelled=0;
  p.selectComponent=()=>({beginBookmarkTransition(expanded){assert.equal(expanded,true);captures++;},cancelBookmarkTransition(){cancelled++;}});
  p.toggleModeSwitch();assert.equal(p.data.modeSwitchExpanded,true);assert.equal(captures,1);
  assert.equal(p.date,date);assert.equal(p.data.selected,'selected');assert.equal(p.data.editable,true);assert.equal(p.dirty,true);
  p.collapseModeSwitch();assert.equal(p.data.modeSwitchExpanded,false);assert.equal(cancelled,1);assert.deepEqual(store.get(),before);
  for(const key of ['journalPicker','drawer','loading','error','saveError','dragging']){
    p.data[key]=true;p.toggleModeSwitch();assert.equal(p.data.modeSwitchExpanded,false,key);p.data[key]='';
  }
});
test('opening menus and selecting a date dismiss the expanded bookmark, including empty theme mode',t=>{
  const {page:p}=fixture(t);
  p.toggleModeSwitch();p.openCalendarOptions();assert.equal(p.data.modeSwitchExpanded,false);p.closeDrawer();
  p.toggleModeSwitch();p.chooseDate(event({date:p.date}));assert.equal(p.data.modeSwitchExpanded,false);
  p.switchMode();assert.equal(p.date,'');p.toggleModeSwitch();assert.equal(p.data.mode,'themes');assert.equal(p.data.modeSwitchExpanded,true);
  p.toggleModeSwitch();assert.equal(p.data.mode,'calendar');assert.equal(p.data.modeSwitchExpanded,true);
});
test('the expanded switch stays open across mode changes and hides three seconds after the last tap',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {page:p,store}=fixture(t);themes(store);
  p.toggleModeSwitch();assert.equal(p.data.mode,'calendar');assert.equal(p.data.modeSwitchExpanded,true);
  t.mock.timers.tick(2000);p.toggleModeSwitch();assert.equal(p.data.mode,'themes');assert.equal(p.data.modeSwitchExpanded,true);
  t.mock.timers.tick(2000);assert.equal(p.data.modeSwitchExpanded,true,'The first tap timer cannot close the newly switched button');
  p.toggleModeSwitch();assert.equal(p.data.mode,'calendar');
  t.mock.timers.tick(2999);assert.equal(p.data.modeSwitchExpanded,true);
  t.mock.timers.tick(1);assert.equal(p.data.modeSwitchExpanded,false);assert.equal(p.modeSwitchTimer,null);
  p.toggleModeSwitch();assert.equal(p.data.mode,'calendar','After timeout, the next tap only expands');
  t.mock.timers.tick(3000);assert.equal(p.data.modeSwitchExpanded,false,'Expansion without switching also times out');
});
test('dismissal and page lifecycle cancel the idle timer without affecting a later expansion',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {page:p}=fixture(t);
  p.toggleModeSwitch();t.mock.timers.tick(2000);p.collapseModeSwitch();assert.equal(p.modeSwitchTimer,null);
  p.toggleModeSwitch();t.mock.timers.tick(1000);assert.equal(p.data.modeSwitchExpanded,true);
  p.onHide();assert.equal(p.modeSwitchTimer,null);assert.equal(p.data.modeSwitchExpanded,false);
  t.mock.timers.tick(5000);p.toggleModeSwitch();assert.equal(p.data.modeSwitchExpanded,true);
  p.onUnload();assert.equal(p.modeSwitchTimer,null);t.mock.timers.tick(5000);
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

test('theme rail and picker retain the outgoing board and request the same targeted transition as dates', t => {
  const { page: p, store } = fixture(t), { first, second } = themes(store);
  const memory = store.add('transition', '2026-10-22', photo('transition'));
  store.place(memory, first); p.refresh();
  const transitions = [], models = [], setData = p.setData;
  p.selectComponent = () => ({ touchCancel() {}, beginNavigationTransition(id) { transitions.push({ from: p.data.model.id, to: id }); } });
  p.setData = function(update, done) { if (Object.hasOwn(update, 'model')) models.push(update.model); setData.call(this, update, done); };
  p.chooseDate(event({ date: '2026-10-20' }));
  p.chooseTheme(event({ id: first }));
  p.openJournalPicker(); p.chooseTheme(event({ id: second }));
  assert.deepEqual(transitions, [
    { from: '2026-10-22', to: '2026-10-20' },
    { from: '2026-10-20', to: first },
    { from: first, to: second }
  ]);
  assert.ok(models.every(Boolean), 'Valid board switches never clear the rendered model between frames');
  assert.equal(p.data.model.id, second); assert.equal(p.data.count, 0); assert.equal(p.data.journalPicker, '');
  p.chooseTheme(event({ id: second })); assert.equal(transitions.length, 3, 'Reselecting the active theme does not flash');
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

test('both more menus hide the canvas in a completed render before mounting, and reject repeated taps',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {page:p,store}=fixture(t);themes(store);
  const oldWx=global.wx;t.after(()=>{global.wx=oldWx;});
  let paint,ready,captures=0;global.wx={nextTick:fn=>{paint=fn;}};
  p.selectComponent=()=>({touchCancel(){},prepareOverlay(){captures++;return new Promise(resolve=>{ready=resolve;});}});
  for(const mode of ['calendar','themes']) {
    if(mode==='themes')p.switchMode();
    const open=()=>mode==='calendar'?p.openCalendarOptions():p.openSelection();
    const opening=open();assert.equal(p.data.drawer,'');assert.equal(p.data.pickerPreparing,true);
    open();assert.equal(captures,mode==='calendar'?1:2,'A second tap cannot restart preparation');
    ready(true);await opening;
    assert.equal(p.data.boardOccluded,true);assert.equal(p.data.drawer,'','Menu waits until the hidden canvas has rendered');
    paint();assert.equal(p.data.drawer,mode==='calendar'?'calendar-options':'theme');
    assert.equal(p.data.boardOccluded,false);assert.equal(p.data.pickerPreparing,false);
    p.closeDrawer();t.mock.timers.tick(220);
  }
});

test('failed menu captures use pre-occlusion, and cancellation cannot leave a hidden board or open a stale menu',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {page:p}=fixture(t);const oldWx=global.wx;t.after(()=>{global.wx=oldWx;});
  let paint;global.wx={nextTick:fn=>{paint=fn;}};
  p.selectComponent=()=>({touchCancel(){},prepareOverlay:()=>Promise.reject(Error('capture failed'))});
  await p.openCalendarOptions();assert.equal(p.data.boardOccluded,true);assert.equal(p.data.drawer,'');
  p.closeDrawer();paint();assert.equal(p.data.boardOccluded,false);assert.equal(p.data.drawer,'');assert.equal(p.data.navigationBusy,false);
  await p.openCalendarOptions();paint();assert.equal(p.data.drawer,'calendar-options');p.closeDrawer();t.mock.timers.tick(220);
  let ready;p.selectComponent=()=>({touchCancel(){},prepareOverlay:()=>new Promise(resolve=>{ready=resolve;})});
  const opening=p.openCalendarOptions();p.onHide();ready(true);await opening;
  assert.equal(p.data.drawer,'');assert.equal(p.data.boardOccluded,false);assert.equal(p.data.pickerPreparing,false);
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

test('theme rename returns to the existing More menu after back, cancel, scrim or successful save', async t => {
  const { page: p, store } = fixture(t), { first } = themes(store);
  p.switchMode(); p.chooseTheme(event({ id: first })); p.openSelection();
  const before = clone(store.get());
  for (const close of ['backSmoothSheet', 'cancelForm', 'closeSmoothSheet']) {
    p.renameFromSheet(); assert.equal(p.data.sheetScene, 'rename'); assert.equal(p.data.editingId, first);
    p.input({ detail: { value: '未保存的名字' } }); p[close]();
    assert.equal(p.data.sheetScene, 'menu'); assert.equal(p.data.drawer, 'theme');
    assert.equal(p.data.sheetClosing, false); assert.equal(p.data.formOpen, false);
    assert.deepEqual(store.get(), before); assert.equal(p.date, first);
  }
  p.renameFromSheet(); p.input({ detail: { value: '新的收藏' } }); await p.save();
  assert.equal(p.data.sheetScene, 'menu'); assert.equal(p.data.drawer, 'theme'); assert.equal(p.data.formOpen, false);
  assert.equal(store.board(first).title, '新的收藏'); assert.equal(p.data.themeRail.find(item => item.id === first).title, '新的收藏');
});

test('failed rename remains editable in More, and saving blocks dismissal through every return control', async t => {
  const f = fixture(t), p = f.page, { first } = themes(f.store);
  p.switchMode(); p.chooseTheme(event({ id: first })); p.openSelection(); p.renameFromSheet();
  p.input({ detail: { value: '' } }); await p.save();
  assert.equal(p.data.sheetScene, 'rename'); assert.ok(p.data.formError);
  p.input({ detail: { value: '保存失败后重试' } }); f.fail(true); await p.save();
  assert.equal(p.data.sheetScene, 'rename'); assert.equal(p.data.title, '保存失败后重试'); assert.ok(p.data.formError);
  p.setData({ working: true });
  for (const close of ['backSmoothSheet', 'cancelForm', 'closeSmoothSheet']) { p[close](); assert.equal(p.data.sheetScene, 'rename'); }
  p.setData({ working: false }); f.fail(false); await p.save();
  assert.equal(p.data.sheetScene, 'menu'); assert.equal(f.store.board(first).title, '保存失败后重试');
  p.renameFromSheet(); p.onHide(); assert.equal(p.data.sheetScene, ''); assert.equal(p.data.formOpen, false);
});

test('theme delete confirmation stays in More; back, cancel and scrim preserve the board and all memories', t => {
  const { page: p, store } = fixture(t), { first, second } = themes(store);
  platform.call = () => { throw Error('Deletion must not open a system dialog or another page'); };
  p.switchMode(); p.chooseTheme(event({ id: first })); p.openSelection();
  const before = clone(store.get());
  for (const close of ['backSmoothSheet', 'closeSmoothSheet', 'closeDrawer']) {
    p.removeThemeFromSheet(); assert.equal(p.data.sheetScene, 'delete');
    assert.equal(p.data.sheetDeleteId, first); assert.equal(p.data.sheetDeleteTitle, '日常碎片');
    assert.equal(p.data.sheetClosing, false); assert.equal(p.data.navigationBusy, true);
    p.switchMode(); p.chooseTheme(event({ id: second })); assert.equal(p.date, first); assert.equal(p.data.mode, 'themes');
    p[close](); assert.equal(p.data.sheetScene, 'menu'); assert.equal(p.data.drawer, 'theme');
    assert.equal(p.data.sheetDeleteId, ''); assert.equal(p.data.sheetClosing, false);
    p.confirmRemoveThemeFromSheet(); assert.deepEqual(store.get(), before);
  }
  p.removeThemeFromSheet(); p.onHide(); assert.equal(p.data.sheetScene, ''); assert.equal(p.data.sheetDeleteId, '');
  p.confirmRemoveThemeFromSheet(); assert.deepEqual(store.get(), before);
});

test('confirmed deletion closes the sheet once, retains memories and other boards, and handles the final theme', t => {
  const { page: p, store } = fixture(t), { first, second } = themes(store);
  const id = store.add('delete-sheet', '2026-10-22', photo('delete-sheet'), first);
  store.edit(id, '照片和文字都要保留', '未分类'); store.place(id, second);
  p.switchMode(); p.chooseTheme(event({ id: first })); p.openSelection(); p.removeThemeFromSheet();
  const before = clone(store.get());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const oldWx = global.wx; global.wx = {}; t.after(() => { global.wx = oldWx; });
  platform.call = () => { throw Error('Deletion must not open a system dialog or another page'); };
  p.confirmRemoveThemeFromSheet(); assert.equal(p.data.sheetClosing, true); assert.equal(p.date, first);
  assert.equal(store.get().boards[first], undefined); assert.deepEqual(store.get().memories, before.memories);
  for (const [key, value] of Object.entries(before.boards)) if (key !== first) assert.deepEqual(store.get().boards[key], value);
  const revision = store.get().revision; p.confirmRemoveThemeFromSheet(); assert.equal(store.get().revision, revision);
  t.mock.timers.tick(219); assert.equal(p.data.sheetScene, 'delete');
  t.mock.timers.tick(1); assert.equal(p.data.sheetScene, ''); assert.equal(p.date, second); assert.equal(p.data.navigationBusy, false);
  p.openSelection(); p.removeThemeFromSheet(); p.confirmRemoveThemeFromSheet(); t.mock.timers.tick(220);
  assert.equal(p.date, ''); assert.equal(p.data.model, null); assert.equal(p.data.error, ''); assert.equal(p.data.mode, 'themes');
  assert.deepEqual(store.get().memories, before.memories); assert.deepEqual(store.get().boards['2026-10-22'], before.boards['2026-10-22']);
});

test('failed deletion keeps the confirmation for retry and blocks stale or in-progress confirmation', t => {
  const f = fixture(t), p = f.page, { first, second } = themes(f.store);
  p.switchMode(); p.chooseTheme(event({ id: first })); p.openSelection(); p.removeThemeFromSheet();
  const before = clone(f.store.get());
  f.fail(true); p.confirmRemoveThemeFromSheet();
  assert.equal(p.data.sheetScene, 'delete'); assert.equal(p.data.sheetClosing, false); assert.equal(p.data.working, false);
  assert.equal(p.data.sheetDeleteId, first); assert.ok(p.data.sheetDeleteError); assert.deepEqual(f.store.get(), before);
  p.setData({ working: true });
  for (const action of ['backSmoothSheet', 'closeSmoothSheet', 'confirmRemoveThemeFromSheet']) {
    p[action](); assert.equal(p.data.sheetScene, 'delete'); assert.deepEqual(f.store.get(), before);
  }
  p.setData({ working: false }); f.fail(false);
  p.date = second; p.confirmRemoveThemeFromSheet(); assert.deepEqual(f.store.get(), before); p.date = first;
  p.confirmRemoveThemeFromSheet(); assert.equal(p.data.sheetScene, ''); assert.equal(p.data.sheetDeleteError, '');
  assert.equal(f.store.get().boards[first], undefined); assert.equal(p.date, second);
});
