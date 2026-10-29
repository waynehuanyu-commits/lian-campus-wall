/**
 * 详情页「热门话题」轮播：取园区热议前三（排除当前帖），上下滚动，点一下打开对应帖子。
 * 数据走 repo.getWeeklyHot，和首页共用本地缓存，不额外请求云函数。
 */
const repo = require('../../utils/repo')
const postNav = require('../../utils/post-nav')
const track = require('../../utils/track')

Component({
  properties: {
    excludeId: { type: String, value: '' },
    surface: { type: String, value: 'detail' }
  },

  data: {
    items: []
  },

  lifetimes: {
    attached() {
      this.load()
    }
  },

  methods: {
    async load() {
      try {
        const board = await repo.getWeeklyHot({})
        const source = board && board.enabled
          ? ((board.items && board.items.length) ? board.items : (board.preview || []))
          : []
        const exclude = this.properties.excludeId
        const items = source
          .filter((item) => item && item.contentId && item.contentId !== exclude)
          .slice(0, 3)
          .map((item, index) => ({
            key: `${item.contentType || 'wall'}:${item.contentId}`,
            id: item.contentId,
            type: item.contentType === 'forum' ? 'forum' : 'wall',
            rank: index + 1,
            title: item.title || item.oneLiner || '热门话题'
          }))
        this.setData({ items })
      } catch (err) {
        // 热榜拿不到就不显示，不影响详情页
        this.setData({ items: [] })
      }
    },

    onTap(e) {
      const { id, type, rank } = e.currentTarget.dataset
      if (!id) return
      track.weeklyHotClick({ surface: this.properties.surface, source: 'detail_ticker', contentId: id, contentType: type, rank: Number(rank) || 0, tag: '' })
      postNav.openPostDetail(type, id)
    }
  }
})
