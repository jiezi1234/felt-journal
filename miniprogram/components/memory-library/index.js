const { getStore } = require('../../core/store');
const libraries = require('../../core/memory-libraries');
const config = require('../../core/config');
const platform = require('../../services/platform');
const { newId } = require('../../services/photo-task');
const modal = require('../../services/modal-presentation');
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: { mode: { type: String, value: 'browse' }, memoryId: String, covered: Boolean },
  data: { libraries: [], allCount: 0, allImages: [], libraryId: '', libraryTitle: '', items: [], visibleItems: [], limit: 30,
    selectedIds: [], selectionCount: 0, selectedSummary: '', formOpen: false, formTitle: '', editingId: '', maxTitle: config.maxLibraryTitle,
    query: '', scrollTop: 0, working: false, error: '', missing: {}, loaded: false },
  lifetimes: {
    attached() { modal.mount(this); this.store = getStore(); this.refresh(); },
    detached() { this.dead = true; modal.dispose(this); }
  },
  observers: { covered(value) { if (!value && this.store && !this.dead) this.refresh(); } },
  pageLifetimes: { show() { if (this.store) this.refresh(); } },
  methods: {
    refresh() {
      try {
        const state = this.store.load();
        if (this.data.mode === 'pick' && !state.memories[this.data.memoryId]) throw new Error('这条记忆已被删除');
        const rows = libraries.list(state), all = libraries.members(state, libraries.ALL);
        if (!this.data.loaded && this.data.mode === 'pick') this.setData({ selectedIds: libraries.forMemory(state, this.data.memoryId).map(item => item.id) });
        const current = this.data.libraryId === libraries.ALL ? { title: '全部物体' } : (state.libraries || {})[this.data.libraryId];
        const libraryId = current ? this.data.libraryId : '';
        const selected = this.data.selectedIds.filter(id => rows.some(item => item.id === id));
        this.setData({ loaded: true, error: '', selectedIds: selected, libraries: rows.map(item => ({ ...item, checked: selected.includes(item.id) })),
          allCount: all.length, allImages: all.slice(0, 3).map(item => ({ id: item.id, path: item.subjectPath })),
          libraryId, libraryTitle: current ? current.title : '', selectionCount: selected.length,
          selectedSummary: rows.filter(item => selected.includes(item.id)).map(item => item.title).join('、'),
          items: libraryId ? libraries.members(state, libraryId).map(item => ({ id: item.id, path: item.subjectPath, date: item.date, text: item.text, category: item.category })) : [] });
        this.filter();
      } catch (error) { this.setData({ error: platform.message(error, '记忆库读取失败，请重试') }); }
    },
    filter() {
      const query = this.data.query.trim().toLowerCase();
      const items = this.data.items.filter(item => !query || `${item.text} ${item.date} ${item.category}`.toLowerCase().includes(query));
      this.setData({ filteredCount: items.length, visibleItems: items.slice(0, this.data.limit) });
    },
    search(e) { this.setData({ query: e.detail.value, limit: 30, scrollTop: 0 }); this.filter(); },
    more() { if (!this.data.covered && this.data.visibleItems.length < this.data.filteredCount) { this.setData({ limit: this.data.limit + 30 }); this.filter(); } },
    scrolled(e) { this.galleryScrollTop = e.detail.scrollTop; },
    open(e) {
      if (this.data.working || this.data.covered || this.data.formOpen || this.data.modalClosing) return;
      const id = e.currentTarget.dataset.id;
      if (id !== libraries.ALL && !this.data.libraries.some(item => item.id === id)) return;
      if (this.data.mode === 'pick') {
        if (id === libraries.ALL) return;
        const selectedIds = this.data.selectedIds.includes(id) ? this.data.selectedIds.filter(value => value !== id) : [...this.data.selectedIds, id];
        this.setData({ selectedIds, error: '' }); this.refresh(); return;
      }
      this.setData({ libraryId: id, query: '', limit: 30, scrollTop: 0, error: '' }); this.galleryScrollTop = 0; this.refresh();
    },
    openMemory(e) {
      const id = e.currentTarget.dataset.id;
      if (this.data.mode !== 'browse' || this.data.covered || this.data.working || this.data.modalClosing || !this.data.visibleItems.some(item => item.id === id)) return;
      this.setData({ scrollTop: this.galleryScrollTop || 0 });
      this.triggerEvent('memory', { id });
    },
    back() {
      if (this.data.working || this.data.covered || this.data.modalClosing) return;
      if (this.data.formOpen) { this.setData({ formOpen: false, error: '' }); return; }
      this.setData({ libraryId: '', query: '', error: '' }); this.refresh();
    },
    create() {
      if (this.data.working || this.data.covered || this.data.modalClosing) return;
      this.createId = newId(); this.setData({ formOpen: true, editingId: '', formTitle: '', error: '' });
    },
    nameInput(e) { this.setData({ formTitle: e.detail.value, error: '' }); },
    saveName() {
      if (!this.data.formOpen || this.data.working || this.data.covered) return;
      this.setData({ working: true, error: '' });
      try {
        this.store.load();
        const id = this.data.editingId || this.store.createLibrary(this.createId, this.data.formTitle);
        if (this.data.editingId) this.store.renameLibrary(id, this.data.formTitle);
        const update = { formOpen: false };
        if (this.data.mode === 'pick' && !this.data.selectedIds.includes(id)) update.selectedIds = [...this.data.selectedIds, id];
        else if (this.data.mode === 'browse') Object.assign(update, { libraryId: id, query: '', limit: 30, scrollTop: 0 });
        this.setData(update); this.refresh(); this.triggerEvent('change');
      } catch (error) { this.setData({ error: platform.message(error, '记忆库未保存，请重试') }); }
      finally { this.setData({ working: false }); }
    },
    async options() {
      if (this.data.working || this.data.covered || !this.data.libraryId || this.data.libraryId === libraries.ALL) return;
      const id = this.data.libraryId; this.setData({ working: true, error: '' });
      try {
        const result = await platform.call('showActionSheet', { itemList: ['重命名记忆库', '删除记忆库'] });
        if (this.dead) return;
        if (result.tapIndex === 0) this.setData({ formOpen: true, editingId: id, formTitle: this.data.libraryTitle });
        else if (result.tapIndex === 1) {
          const choice = await platform.call('showModal', { title: '删除这个记忆库？', content: '只删除这个收藏夹，物体、文字和板面上的摆放都会保留。', confirmText: '删除记忆库', confirmColor: '#A35F4D' });
          if (choice.confirm && !this.dead) { this.store.load(); this.store.deleteLibrary(id); this.setData({ libraryId: '' }); this.refresh(); this.triggerEvent('change'); }
        }
      } catch (error) { if (!this.dead && !/cancel/i.test(error.errMsg || error.message || '')) this.setData({ error: platform.message(error, '操作未完成，请重试') }); }
      finally { if (!this.dead) this.setData({ working: false }); }
    },
    confirm() {
      if (this.data.mode !== 'pick' || this.data.working || this.data.formOpen || this.data.covered || this.data.modalClosing) return;
      this.setData({ working: true, error: '' });
      try {
        this.store.load(); this.store.setMemoryLibraries(this.data.memoryId, this.data.selectedIds);
        this.triggerEvent('change', { id: this.data.memoryId });
        modal.close(this, () => this.triggerEvent('close', { saved: true }));
      } catch (error) { this.setData({ error: platform.message(error, '归档未保存，请重试') }); }
      finally { this.setData({ working: false }); }
    },
    close() { if (!this.data.working && !this.data.covered) modal.close(this, () => this.triggerEvent('close')); },
    imageError(e) { const id = e.currentTarget.dataset.id; if (id) this.setData({ missing: { ...this.data.missing, [id]: true } }); },
    stop() {}
  }
});
