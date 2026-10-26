// Read-only native regression: replay touches swallowed by the raised canvas.
// Uses an existing non-empty board; no storage replacement, sending or album API.
const assert = require('node:assert/strict');
const automator = require('miniprogram-automator');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const keys = ['felt-journal:v1', 'felt-journal:drafts:v1', 'felt-journal:memory-drafts:v1'];
(async () => {
  let mini, before, ownsCard = false;
  const state = () => mini.evaluate(() => {
    const p = getCurrentPages().slice(-1)[0], b = p.selectComponent('#today-board'), card = p.selectComponent('#share-card');
    return { share: !!p.data.shareBoardId, busy: p.data.navigationBusy, hidden: b.data.canvasHidden,
      generating: card && card.data.generating, error: card && card.data.error, image: !!(card && card.data.imagePath) };
  });
  async function wait(predicate) {
    for (let i = 0; i < 100; i++) { const value = await state(); if (predicate(value)) return value; await pause(100); }
    throw Error('Share entry did not settle: ' + JSON.stringify(await state()));
  }
  try {
    mini = await automator.connect({ wsEndpoint: process.env.WECHAT_AUTOMATION_URL || 'ws://127.0.0.1:9420' });
    before = await mini.evaluate(keys => {
      const p = getCurrentPages().slice(-1)[0];
      if (!p || p.route !== 'pages/index/index' || p.busy() || p.data.drawer || p.data.journalPicker || p.dirty || p.noteDirty || !p.data.count) throw Error('Start on an idle, non-empty home board');
      if (typeof p.overhangTap !== 'function' || !p.selectComponent('#today-board').data.forwardOverhangTaps) throw Error('Compile the updated code before testing');
      return { disk: keys.map(key => wx.getStorageSync(key)), model: JSON.stringify(p.data.model), selected: p.data.selected, editable: p.data.editable };
    }, keys);
    for (const nativeCoordinates of [false, true]) {
      const hit = await mini.evaluate(nativeCoordinates => new Promise(resolve => {
        const p = getCurrentPages().slice(-1)[0], b = p.selectComponent('#today-board');
        p.createSelectorQuery().select('#export-today').boundingClientRect().exec(rows => {
          b.createSelectorQuery().select('#feltCanvas').boundingClientRect().exec(canvases => {
            const button = rows[0], canvas = canvases[0], x = button.left + button.width / 2, y = button.top + button.height / 2;
            resolve({ overlaps: x >= canvas.left && x <= canvas.right && y >= canvas.top && y <= canvas.bottom,
              touch: nativeCoordinates ? { identifier: 0, x: x - canvas.left, y: y - canvas.top } : { identifier: 0, clientX: x, clientY: y } });
          });
        });
      }), nativeCoordinates);
      assert.equal(hit.overlaps, true, 'Exercise the actual canvas/header overlap, not just a synthetic button tap');
      await mini.evaluate(touch => getCurrentPages().slice(-1)[0].selectComponent('#today-board').touchStart({ touches: [touch] }), hit.touch);
      await pause(80);
      assert.equal(await mini.evaluate(() => !!getCurrentPages().slice(-1)[0].selectComponent('#today-board').gesture.overhang), true);
      ownsCard = true;
      await mini.evaluate(touch => getCurrentPages().slice(-1)[0].selectComponent('#today-board').touchEnd({ touches: [], changedTouches: [touch] }), hit.touch);
      const opened = await wait(s => s.share && !s.generating);
      assert.equal(opened.error, ''); assert.equal(opened.image, true); assert.equal(opened.busy, true);
      await wait(s => s.hidden);
      await mini.evaluate(() => getCurrentPages().slice(-1)[0].selectComponent('#share-card').close());
      await wait(s => !s.share && !s.busy && !s.hidden); ownsCard = false;
      console.log('PASS: ' + (nativeCoordinates ? 'Canvas-local' : 'Viewport') + ' header tap opens a real export card and returns to the board');
    }
    const after = await mini.evaluate(keys => {
      const p = getCurrentPages().slice(-1)[0];
      return { disk: keys.map(key => wx.getStorageSync(key)), model: JSON.stringify(p.data.model), selected: p.data.selected, editable: p.data.editable };
    }, keys);
    assert.deepEqual(after, before);
    console.log('PASS: board position, selection, edit mode and stored journal remain unchanged; no image was sent');
  } finally {
    if (mini) {
      if (ownsCard) await mini.evaluate(() => { const p = getCurrentPages().slice(-1)[0], c = p.selectComponent('#share-card'); if (c) c.close(); }).catch(() => {});
      mini.disconnect();
    }
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
