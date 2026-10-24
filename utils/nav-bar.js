// 自定义导航栏尺寸：高度对齐胶囊按钮，capsule 为右侧需要让出的宽度（px）
function readNavMetrics() {
  try {
    const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menu = wx.getMenuButtonBoundingClientRect()
    const statusBar = win.statusBarHeight || 20
    const gap = Math.max(menu.top - statusBar, 4)
    return {
      top: statusBar,
      height: menu.height + gap * 2,
      capsule: win.windowWidth - menu.left + 8
    }
  } catch (e) {
    return { top: 20, height: 44, capsule: 100 }
  }
}

module.exports = { readNavMetrics }
