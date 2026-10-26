// Custom navigation uses the real system status bar and WeChat menu bounds.
// Bad/empty simulator values fall back to a 44px navigation row.
function layout(info = {}, menu = {}) {
  const width = Number.isFinite(info.windowWidth) && info.windowWidth > 0 ? info.windowWidth : 375;
  const status = Number.isFinite(info.statusBarHeight) && info.statusBarHeight >= 0 ? info.statusBarHeight : 20;
  const valid = Number.isFinite(menu.top) && menu.top >= status && Number.isFinite(menu.height) && menu.height > 0 && menu.height <= 60
    && Number.isFinite(menu.left) && menu.left > width / 2 && menu.left < width;
  const nav = valid ? Math.max(44, menu.height + (menu.top - status) * 2) : 44;
  return { headerStatus: status, headerHeight: status + nav, headerMenuInset: valid ? width - menu.left + 8 : 104 };
}
module.exports = { layout };
