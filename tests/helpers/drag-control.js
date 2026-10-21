const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Dispatch through the actual bound nodes. value is a size ratio or degrees.
module.exports = async function dragControl(mini, board, selector, op, value, options = {}) {
  const points = await mini.evaluate((selector, op, value) => new Promise(resolve => {
    const b = getCurrentPages().slice(-1)[0].selectComponent(selector);
    b.createSelectorQuery().select('.board-shell').boundingClientRect(rect => {
      const item = b.displayModel.items.find(p => p.memoryId === b.data.selected);
      const handle = b.data.handles.find(h => h.op === op), s = b.screenWidth / 1500;
      const cx = (item.x + 45) * s, cy = (item.y + 45) * s, dx = handle.x - cx, dy = handle.y - cy;
      const points = [0, .25, .5, .75, 1].map(fraction => {
        const angle = value * fraction * Math.PI / 180, ratio = 1 + (value - 1) * fraction;
        const x = cx + (op === 'resize' ? dx * ratio : dx * Math.cos(angle) - dy * Math.sin(angle));
        const y = cy + (op === 'resize' ? dy * ratio : dx * Math.sin(angle) + dy * Math.cos(angle));
        return { identifier: 0, clientX: rect.left + x, clientY: rect.top + y };
      }); resolve(points);
    }).exec();
  }), selector, op, value);
  const node = await board.$(options.canvas ? '#feltCanvas' : '.grip[data-op="' + op + '"]');
  await node.touchstart({ touches: [points[0]], changedTouches: [points[0]] });
  let ready = false;
  for (let n = 0; n < 50; n++) {
    ready = await mini.evaluate((selector, op) => {
      const g = getCurrentPages().slice(-1)[0].selectComponent(selector).gesture;
      return !!g && !g.pending && g.control === op;
    }, selector, op);
    if (ready) break;
    await pause(20);
  }
  if (!ready) throw Error('Drag control did not receive touchstart: ' + op);
  for (let i = 1; i < points.length; i++) {
    await node.touchmove({ touches: [points[i]], changedTouches: [points[i]] }); await pause(60);
    if (options.onMove) await options.onMove(i / (points.length - 1), points[i]);
  }
  if (options.cancel) await node.dispatchEvent({ eventName: 'touchcancel', touches: [], changedTouches: [points[4]] });
  else await node.touchend({ touches: [], changedTouches: [points[4]] });
  return node;
};
