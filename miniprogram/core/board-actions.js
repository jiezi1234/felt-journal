const { rounded } = require('./board-material');
const B = require('./config').board;

// Screen-pixel geometry is shared by Canvas paint, native touch hits and the
// transparent accessible buttons. This UI pass never runs in board exports.
function layout(width, height, state) {
  if (!state.showActions || state.covered || !state.interactive || state.landingId || state.dragging) return [];
  const top = height - 62, right = width - 62;
  const actions = [{ action: 'add', id: 'add-theme-memory', label: '添加记忆', x: right, y: top, width: 50, height: 50, disabled: state.actionsDisabled || !state.canAdd }];
  if (state.selected) {
    const cell = Math.min(300, width - 84) / 4;
    [['undo', '撤销', !state.canUndo], ['view', '查看', false], ['front', '置前', !state.canBringToFront], ['remove', '移出', false]].forEach(([action, label, disabled], i) => {
      const ids = { undo: 'theme-undo', view: 'theme-view-memory', front: 'theme-layer-front', remove: 'theme-remove-placement' };
      actions.push({ action, id: ids[action], label, x: 12 + cell * i, y: top + 1, width: cell, height: 48, disabled: state.actionsDisabled || disabled });
    });
  }
  return actions.map(a => ({ ...a, style: `left:${a.x}px;top:${a.y}px;width:${a.width}px;height:${a.height}px;` }));
}
function hit(actions, point) {
  return point && actions.find(a => point.x >= a.x && point.x <= a.x + a.width && point.y >= a.y && point.y <= a.y + a.height);
}
function paint(ctx, actions, screenWidth, pressed) {
  if (!actions.length) return;
  ctx.save(); ctx.scale(B.width / screenWidth, B.width / screenWidth);
  ctx.setLineDash([]); ctx.lineWidth = 1;
  const row = actions.filter(a => a.action !== 'add');
  ctx.shadowColor = 'rgba(40,31,20,.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  if (row.length) {
    rounded(ctx, row[0].x, row[0].y, row.reduce((n, a) => n + a.width, 0), 48, 18);
    ctx.fillStyle = '#FFFCF6'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#E9E0D3'; ctx.stroke();
  }
  actions.forEach(a => {
    ctx.save(); ctx.translate(a.x + a.width / 2, a.y + a.height / 2);
    ctx.globalAlpha = a.disabled ? 0.45 : 1;
    if (a.action === 'add') {
      ctx.shadowColor = 'rgba(40,31,20,.25)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.beginPath(); ctx.arc(0, 0, 25, 0, Math.PI * 2); ctx.fillStyle = pressed === a.action ? '#554A3D' : '#292722'; ctx.fill();
      ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#FFFBF1'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(8, 0); ctx.moveTo(0, -8); ctx.lineTo(0, 8); ctx.stroke();
    } else {
      if (pressed === a.action && !a.disabled) { rounded(ctx, -a.width / 2 + 3, -20, a.width - 6, 40, 12); ctx.fillStyle = '#EEE5D7'; ctx.fill(); }
      ctx.fillStyle = '#69594C'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(a.label, 0, 0);
    }
    ctx.restore();
  });
  ctx.restore();
}
module.exports = { layout, hit, paint };
