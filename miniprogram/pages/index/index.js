const { createBoardEditor } = require('../../services/board-editor');
const dates = require('../../core/date');
const platform = require('../../services/platform');
const motion = require('../../core/sticker-motion');
const { createThemeBoardPage } = require('../../services/theme-board-page');
const navigation = require('../../core/journal-navigation');
const editor = createBoardEditor();
const theme = createThemeBoardPage();
Page({
  ...editor, ...theme,
  data: { ...theme.data, inlineTheme: false, mode: 'calendar', dailyDate: '', recentDays: [], themeRail: [], journalThemes: [], journalPicker: '', pickerClosing:false, pickerPreparing:false, previewReady:{}, previewErrors:{}, contentMotion:'',
    journalYear: 0, journalMonth: 0, calendarCells: [], canNextMonth: false, weekdays: ['一', '二', '三', '四', '五', '六', '日'],
    navigationBusy: false, editorOpen: false, editorDate: '' },
  syncNavigation() { this.setData({ navigationBusy: this.busy() }); platform.syncTab(this, 'today', true); },
  onLoad() { editor.onLoad.call(this, { date: dates.key() }); this.dailyDate = this.date; this.lastToday = dates.key(); },
  onShow() {
    this.syncNavigation();
    if (!this.data.editorOpen && !this.data.placing && !this.data.memoryCardId && !this.data.shareBoardId) this.refresh();
    clearInterval(this.timer);
    this.timer = setInterval(() => { if (!this.busy() && dates.key() !== this.lastToday) this.refresh(); }, 30000);
  },
  onHide() { clearInterval(this.timer); clearTimeout(this.journalCloseTimer); clearTimeout(this.journalPrepareTimer); this.pickerRequest=(this.pickerRequest||0)+1; this.setData({journalPicker:'',pickerClosing:false,pickerPreparing:false}); editor.onHide.call(this); if (this.data.drawer === 'selection') this.setData({ drawer: '' }); },
  onUnload() { clearInterval(this.timer); clearTimeout(this.journalCloseTimer); clearTimeout(this.journalPrepareTimer); this.pickerRequest=(this.pickerRequest||0)+1; editor.onUnload.call(this); },
  refresh() {
    if (this.disposed) return;
    try {
      this.store.load();
      if (!this.dailyDate) this.dailyDate = this.date || dates.key();
      if (!this.busy() && this.lastToday && this.lastToday !== dates.key() && this.dailyDate === this.lastToday) this.dailyDate = dates.key();
      if (!this.busy()) this.lastToday = dates.key();
      if (this.data.mode === 'themes') {
        const items = navigation.themes(this.store.get());
        this.activeThemeId = navigation.defaultTheme(items, this.activeThemeId === undefined ? this.store.activeTheme() : this.activeThemeId);
        theme.refresh.call(this);
        if (!this.date) this.setData({ date: '', dateLabel: '', isTheme: true, loading: false });
        this.refreshNavigation(); return;
      }
      const date = this.busy() ? this.date : this.dailyDate;
      if (date !== this.date) {
        if (this.dirty && !this.persist()) return;
        this.date = date; this.draft = null; this.history = null; this.checkedDraft = false;
        this.setData({ editable: false, selected: '' });
      }
      editor.refresh.call(this);
      this.refreshNavigation();
    } catch (e) { this.setData({ loading: false, error: platform.message(e, '本地记录读取失败，请重试') }); }
  },
  busy() { return !!(this.data.pickerPreparing || this.data.editorOpen || this.data.placing || this.data.memoryCardId || this.data.shareBoardId || this.data.task || this.data.recovering || this.data.formOpen || this.data.working || this.data.dragging || this.data.swiping || this.data.openingLibrary || this.photoTask || this.memoryOpening || this.mutating); },
  refreshNavigation() {
    const state = this.store.get(), items = navigation.themes(state), mode = this.data.mode;
    const selected = items.findIndex(item => item.id === this.activeThemeId);
    let start = this.themeRailStart || 0;
    if (selected < start) start = Math.max(0, selected);
    if (selected >= start + 3) start = selected - 2;
    this.themeRailStart = start;
    this.setData({ todayDate: dates.key(), dailyDate: this.dailyDate || dates.key(), recentDays: navigation.recent(state, this.dailyDate || dates.key(), dates.key()),
      journalThemes: items, themeRail: items.slice(start, start + 3), navigationBusy: this.busy(), inlineTheme: mode === 'themes',
      modeSubtitle: mode === 'themes' ? this.data.dateLabel || '按主题收藏喜欢的日子' : `${Number(this.date.slice(5, 7))}月${Number(this.date.slice(8))}日 · 星期${navigation.weekday(this.date)}` });
    if (this.data.journalPicker === 'calendar') this.refreshCalendar();
  },
  display() { editor.display.call(this); this.refreshNavigation(); },
  prepareBoardChange() {
    if (this.busy() || this.data.loading || this.data.error || this.data.drawer || this.data.pickerClosing) return false;
    this.cancelGesture();
    if (this.dirty && !this.persist() || this.noteDirty && !this.saveNote()) return false;
    this.setData({ editable: false, selected: '' }); return true;
  },
  beginBoardTransition() {
    const board=this.selectComponent && this.selectComponent('#today-board');
    if (board && board.beginNavigationTransition) board.beginNavigationTransition();
    this.setData({contentMotion:this.data.contentMotion === 'a' ? 'b' : 'a'});
  },
  switchMode() {
    if (!this.prepareBoardChange()) return;
    this.beginBoardTransition();
    if (this.data.mode === 'calendar') this.dailyDate = this.date;
    this.setData({ mode: this.data.mode === 'calendar' ? 'themes' : 'calendar' }); this.refresh(); this.closeJournalPicker();
  },
  chooseDate(e) {
    const date = e.currentTarget.dataset.date;
    if (!dates.valid(date) || date > dates.key() || !this.prepareBoardChange()) return;
    if (this.data.mode !== 'calendar' || date !== this.date) this.beginBoardTransition();
    this.dailyDate = date; this.setData({ mode: 'calendar' }); this.refresh(); this.closeJournalPicker();
  },
  returnToday() { this.chooseDate({ currentTarget: { dataset: { date: dates.key() } } }); },
  chooseTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!this.data.journalThemes.some(item => item.id === id) || !this.prepareBoardChange()) return;
    if (this.data.mode !== 'themes' || id !== this.date) this.beginBoardTransition();
    this.activeThemeId = id; this.setData({ mode: 'themes' }); this.refresh(); this.closeJournalPicker();
  },
  openJournalPicker() {
    if (!this.prepareBoardChange()) return;
    const mode = this.data.mode;
    if (mode === 'calendar') { const [y, m] = this.dailyDate.split('-').map(Number); this.journalYear = y; this.journalMonth = m; }
    const token=this.pickerRequest=(this.pickerRequest||0)+1;
    let opened=false;
    const open=()=>{
      if (opened || this.disposed || token!==this.pickerRequest) return;
      opened=true;clearTimeout(this.journalPrepareTimer);this.journalPrepareTimer=null;
      this.setData({ journalPicker: mode === 'calendar' ? 'calendar' : 'themes', pickerClosing:false, pickerPreparing:false, previewReady:{}, previewErrors:{} }); this.refreshNavigation();
    };
    const board=this.selectComponent && this.selectComponent('#today-board');
    if (!board || !board.prepareOverlay) { open(); return; }
    this.setData({pickerPreparing:true,navigationBusy:true});
    this.journalPrepareTimer=setTimeout(open,900);
    // A failed capture still opens the picker with its native canvas suppressed.
    return Promise.resolve(board.prepareOverlay()).then(open,open);
  },
  closeJournalPicker(done) {
    const after=typeof done === 'function' ? done : null;
    if (!this.data.journalPicker) {
      if(this.data.pickerPreparing){clearTimeout(this.journalPrepareTimer);this.pickerRequest=(this.pickerRequest||0)+1;this.setData({pickerPreparing:false});this.syncNavigation();}
      if (after) after(); return;
    }
    if (this.data.pickerClosing) return;
    const finish=()=>{ this.journalCloseTimer=null; if (this.disposed) return; this.setData({journalPicker:'',pickerClosing:false}); if (after) after(); };
    this.setData({pickerClosing:true});
    if (typeof wx === 'undefined') finish(); else this.journalCloseTimer=setTimeout(finish,180);
  },
  journalPreviewLoaded(e) {
    const key=e.currentTarget.dataset.key;
    if (this.data.journalPicker && key && !this.data.previewReady[key]) this.setData({previewReady:{...this.data.previewReady,[key]:true}});
  },
  journalPreviewFailed(e) {
    const key=e.currentTarget.dataset.key;
    if (this.data.journalPicker && key) this.setData({previewErrors:{...this.data.previewErrors,[key]:true}});
  },
  refreshCalendar() {
    this.setData({ journalYear: this.journalYear, journalMonth: this.journalMonth,
      calendarCells: navigation.month(this.store.get(), this.journalYear, this.journalMonth, dates.key()),
      canNextMonth: `${this.journalYear}-${String(this.journalMonth).padStart(2, '0')}` < dates.key().slice(0, 7) });
  },
  previousMonth() { this.shiftJournalMonth(-1); },
  nextMonth() { if (this.data.canNextMonth) this.shiftJournalMonth(1); },
  shiftJournalMonth(offset) {
    if (this.data.journalPicker !== 'calendar' || this.data.pickerClosing) return;
    const next = dates.shiftMonth(this.journalYear, this.journalMonth, offset); this.journalYear = next.year; this.journalMonth = next.month; this.refreshCalendar();
  },
  memories() { this.closeJournalPicker(()=>platform.call('navigateTo', { url: '/pages/memories/index' }).catch(error => platform.toast(platform.message(error, '记忆库暂时无法打开')))); },
  createJournalTheme() { if (this.prepareBoardChange()) this.closeJournalPicker(()=>{this.setData({mode:'themes'});this.create();}); },
  cancelGesture() { const board = this.selectComponent && this.selectComponent('#today-board'); if (board) board.touchCancel(); },
  canAdjust() { return !this.data.editorOpen && !this.data.journalPicker && !this.data.formOpen && editor.canAdjust.call(this); },
  openBoard() {
    if (this.busy() || this.data.drawer || this.data.journalPicker || this.data.loading || this.data.error) return;
    this.edit();
  },
  primary() {
    if (this.busy() || this.data.journalPicker || this.data.drawer || this.data.loading || this.data.error) return;
    if (this.data.mode === 'themes') { if (!this.date) this.createJournalTheme(); else theme.sourceSheet.call(this); return; }
    this.cancelGesture(); if (this.dirty && !this.persist()) return;
    this.refresh(); if (this.data.error) return;
    this.setData({ editorDate: this.date, editorOpen: true, drawer: '', navigationBusy: true }); this.syncNavigation();
  },
  sourceSheet() { this.primary(); },
  editorChanged() { /* The processing card owns the pending result until placement. */ },
  closeEditor() {
    if (this.data.placing) return;
    this.setData({ editorOpen: false, navigationBusy: false }); this.syncNavigation(); this.refresh();
  },
  startSticker(e) {
    if (this.data.placing || !this.data.editorOpen) return;
    const id = e.detail.id, memory = this.store.get().memories[id];
    const source = memory && motion.imageRect(e.detail.rect, memory);
    if (!source) { this.closeEditor(); this.edit(); return; }
    const token = this.placementToken = (this.placementToken || 0) + 1;
    this.setData({ placing: { id, path: memory.subjectPath, source, token }, selected: id, editable: true });
    this.refresh();
    this.placementTimer = setTimeout(() => this.stickerLanded({ detail: { token } }), 6000);
  },
  stickerLifted(e) {
    if (this.disposed || !this.data.placing || this.data.placing.token !== e.detail.token) return;
    if (this.data.mode === 'themes') { editor.stickerLifted.call(this, e); return; }
    this.setData({ editorOpen: false });
  },
  stickerLanded(e) {
    const placing = this.data.placing;
    if (!placing || this.disposed || e && e.detail && e.detail.token !== placing.token) return;
    editor.stickerLanded.call(this, e);
    this.setData({ editorOpen: false }); this.refreshNavigation(); this.syncNavigation();
  },
  openMemory(e) { if (!this.busy() && !this.data.drawer && !this.data.journalPicker) return this.memory(e); },
  exportToday() { if (!this.busy() && !this.data.journalPicker) this.exportBoard(); },
  openSelection() { if (this.data.mode === 'themes') return theme.openSelection.call(this); if (this.canAdjust()) { this.cancelGesture(); this.setData({ drawer: 'selection' }); } },
  openSelectedTools() { if (this.canAdjust()) { this.cancelGesture(); this.setData({ drawer: 'selection' }); } },
  floatingAction(e) { const action = e.detail.action; if (action === 'record') this.primary(); else if (action === 'tools') this.openSelectedTools(); else if (action === 'today') this.returnToday(); },
  select(e) { return this.data.mode === 'themes' ? theme.select.call(this, e) : editor.select.call(this, e); },
  library() { return this.data.mode === 'themes' ? theme.library.call(this) : editor.library.call(this); },
  placeFromLibrary(e) { return this.data.mode === 'themes' ? theme.placeFromLibrary.call(this, e) : editor.placeFromLibrary.call(this, e); },
  closeDrawer() { return this.data.mode === 'themes' ? theme.closeDrawer.call(this) : editor.closeDrawer.call(this); },
  gestureState(e) { this.setData({ dragging: !!e.detail.active }); this.setData({ navigationBusy: this.busy() }); },
  async cancelPhoto(e) { await editor.cancelPhoto.call(this, e); if (!this.disposed) this.refreshNavigation(); },
  async remove() { await editor.remove.call(this); if (!this.disposed) { if (!this.data.selected) this.setData({ drawer: '' }); this.refreshNavigation(); } }
});
