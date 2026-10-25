// 首页搜索：输入 + 最近搜索；提交后回到首页由信息流展示结果
const HISTORY_KEY = 'cw_search_history_v1'
const HISTORY_MAX = 10

function readHistory() {
  try {
    const list = wx.getStorageSync(HISTORY_KEY)
    return Array.isArray(list) ? list.filter(Boolean).slice(0, HISTORY_MAX) : []
  } catch (e) {
    return []
  }
}

function saveHistory(list) {
  try { wx.setStorageSync(HISTORY_KEY, list) } catch (e) { /* 存不了不影响搜索 */ }
}

Page({
  data: {
    draft: '',
    history: []
  },

  onLoad(query) {
    this.setData({
      draft: decodeURIComponent((query && query.keyword) || ''),
      history: readHistory()
    })
  },

  onInput(e) {
    this.setData({ draft: e.detail.value })
  },

  onConfirm() {
    this.submit(this.data.draft)
  },

  onHistoryTap(e) {
    this.submit(e.currentTarget.dataset.word)
  },

  clearHistory() {
    saveHistory([])
    this.setData({ history: [] })
  },

  submit(word) {
    const keyword = String(word || '').trim()
    if (keyword) {
      const history = [keyword, ...this.data.history.filter((item) => item !== keyword)].slice(0, HISTORY_MAX)
      saveHistory(history)
    }
    const pages = getCurrentPages()
    const prev = pages[pages.length - 2]
    if (prev && typeof prev.applySearch === 'function') prev.applySearch(keyword)
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/forum/forum' })
      }
    })
  },

  onCancel() {
    wx.navigateBack({
      fail() {
        wx.switchTab({ url: '/pages/forum/forum' })
      }
    })
  }
})
