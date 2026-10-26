const { rounded } = require('./board-material');
const B = require('./config').board;

// Screen-pixel geometry is shared by Canvas paint, native touch hits and the
// transparent accessible buttons. This UI pass never runs in board exports.
function layout(width, height, state) {
  if (state.covered || !state.interactive || state.landingId || state.dragging) return [];
  if (state.floatingControls) {
    const controls = state.floatingControls, compact = !!state.compactFloating, addWidth = compact ? 124 : 140;
    // A lifted board keeps the floating controls anchored to the notebook.
    const y = height - (Math.max(16, 6 + (state.bottomInset || 0)) - 3) - 50 + (controls.offsetY || 0);
    const actions = [{ action:'record', id:'journal-canvas-record', label:controls.label, kind:'journal-add', x:(width-addWidth)/2, y, width:addWidth, height:50, disabled:!!controls.disabled }];
    if (controls.quick) {
      const quickWidth = compact ? 56 : 66;
      actions.push({ action:controls.quick, id:'journal-canvas-quick', label:controls.quick === 'tools' ? '布置选项' : '回到今天', kind:'journal-quick', x:width-quickWidth, y:y+3, width:quickWidth, height:44, disabled:!!controls.disabled });
    }
    if (controls.mode) {
      const title = controls.mode === 'themes' ? '主题板' : '日历板', small = height < 260;
      actions.push({ action:'mode', id:'switch-mode', kind:'journal-mode', mode:controls.mode, title,
        label:`当前为${title}，点击切换为${controls.mode === 'themes' ? '日历板' : '主题板'}`,
        x:width-44, y:small ? 12 : 24, width:44, height:small ? 112 : 132, disabled:!!controls.disabled });
    }
    return actions.map(a => ({ ...a, style:`left:${a.x}px;top:${a.y}px;width:${a.width}px;height:${a.height}px;` }));
  }
  if (!state.showActions) return [];
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
function paint(ctx, actions, screenWidth, pressed, hint) {
  if (!actions.length) return;
  ctx.save(); ctx.scale(B.width / screenWidth, B.width / screenWidth);
  if (actions[0].kind === 'journal-add') {
    const compact = actions[0].width === 124;
    ctx.setLineDash([]); ctx.lineWidth = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (hint) {
      ctx.font = '11px sans-serif';
      const width = Math.min(screenWidth, ctx.measureText(hint).width + 18), y = actions[0].y - 21;
      rounded(ctx,(screenWidth-width)/2,y-13,width,26,12); ctx.fillStyle = 'rgba(255,252,246,.88)'; ctx.fill();
      ctx.fillStyle = '#7D6D5E'; ctx.fillText(hint,screenWidth/2,y,width-12);
    }
    actions.forEach(a => {
      if (a.kind === 'journal-mode') { paintBookmark(ctx, a, pressed === a.action); return; }
      ctx.save(); ctx.globalAlpha = a.disabled ? .45 : 1;
      ctx.shadowColor = 'rgba(79,55,21,.24)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 6;
      rounded(ctx,a.x,a.y,a.width,a.height,a.height/2);
      ctx.fillStyle = a.kind === 'journal-add' ? (pressed === a.action ? '#E6C47D' : '#EFD395') : '#FFFCF6'; ctx.fill();
      ctx.shadowColor = 'transparent';
      if (a.kind === 'journal-add') {
        rounded(ctx,a.x+4,a.y+4,a.width-8,a.height-8,23); ctx.setLineDash([3,3]); ctx.strokeStyle = 'rgba(132,103,53,.3)'; ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = '#514126'; ctx.font = '24px sans-serif'; ctx.fillText('＋',a.x+25,a.y+25);
        ctx.font = `${compact ? 13 : 14}px sans-serif`; ctx.fillText(a.label,a.x+a.width/2+11,a.y+25);
      } else {
        ctx.fillStyle = '#79644B'; ctx.font = `${compact ? 11 : 12}px sans-serif`; ctx.fillText(a.label,a.x+a.width/2,a.y+22);
      }
      ctx.restore();
    });
    ctx.restore(); return;
  }
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
function paintBookmark(ctx, a, pressed) {
  ctx.save(); ctx.translate(a.x, a.y); ctx.globalAlpha = a.disabled ? .45 : 1;
  ctx.shadowColor = 'rgba(65,48,28,.18)'; ctx.shadowBlur = 10; ctx.shadowOffsetX = -3; ctx.shadowOffsetY = 4;
  rounded(ctx, .5, .5, a.width-1, a.height-1, 12); ctx.fillStyle = pressed ? '#F3E9D5' : '#FFFCF6'; ctx.fill();
  ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#E2D7C5'; ctx.lineWidth = 1; ctx.stroke();
  // The icon, vertical title and switch mark remain legible on compact boards.
  ctx.strokeStyle = '#94816A'; ctx.lineWidth = 1.2; ctx.setLineDash([]);
  const x = a.width/2, iconY = 16;
  if (a.mode === 'themes') {
    for (const dx of [-6,2]) for (const dy of [0,8]) { rounded(ctx,x+dx,iconY+dy,5,5,1); ctx.stroke(); }
  } else {
    rounded(ctx,x-6,iconY,12,12,2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x-6,iconY+4); ctx.lineTo(x+6,iconY+4);
    ctx.moveTo(x-3,iconY-2); ctx.lineTo(x-3,iconY+2); ctx.moveTo(x+3,iconY-2); ctx.lineTo(x+3,iconY+2); ctx.stroke();
  }
  ctx.fillStyle = '#64533E'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const step = a.height < 132 ? 17 : 20, start = a.height/2-step;
  Array.from(a.title).forEach((char,i)=>ctx.fillText(char,x,start+i*step));
  ctx.font = '18px sans-serif'; ctx.fillStyle = '#94816A'; ctx.fillText('⇄',x,a.height-17);
  ctx.restore();
}
module.exports = { layout, hit, paint };
