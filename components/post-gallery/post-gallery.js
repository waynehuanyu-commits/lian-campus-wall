const media = require('../../utils/media')

const LONG_RATIO = 2.05
const ONE_MAX_WIDTH_RPX = 520
const ONE_LONG_WIDTH_RPX = 420
const ONE_MAX_HEIGHT_RPX = 720
const ONE_LONG_MAX_HEIGHT_RPX = 780

Component({
  properties: {
    urls: {
      type: Array,
      value: []
    }
  },

  data: {
    items: [],
    countClass: 'one'
  },

  observers: {
    urls(list) {
      this.setup(list)
    }
  },

  lifetimes: {
    attached() {
      const sys = wx.getSystemInfoSync()
      this._px = (sys.windowWidth || 375) / 750
      this.setup(this.data.urls)
    }
  },

  methods: {
    setup(list) {
      const urls = (Array.isArray(list) ? list : []).filter(Boolean)
      const items = urls.map((src, index) => ({
        key: `${index}_${src}`,
        index,
        src,
        displaySrc: src,
        status: 'loading',
        isLong: false,
        boxStyle: ''
      }))
      const countClass = items.length <= 1 ? 'one' : (items.length === 2 ? 'two' : 'multi')
      this.setData({ items, countClass })
      items.forEach((item, index) => this.hydrate(index))
    },

    oneBoxStyle(width, height, isLong) {
      if (!width || !height) {
        return isLong
          ? `width:${ONE_LONG_WIDTH_RPX}rpx;height:${Math.round(ONE_LONG_WIDTH_RPX * 1.4)}rpx;`
          : `width:${ONE_MAX_WIDTH_RPX}rpx;height:${ONE_MAX_WIDTH_RPX}rpx;`
      }
      const maxW = isLong ? ONE_LONG_WIDTH_RPX : ONE_MAX_WIDTH_RPX
      const maxH = isLong ? ONE_LONG_MAX_HEIGHT_RPX : ONE_MAX_HEIGHT_RPX
      let w = maxW
      let h = Math.round((maxW * height) / width)
      if (h > maxH) {
        h = maxH
        w = Math.round((maxH * width) / height)
      }
      return `width:${w}rpx;height:${h}rpx;`
    },

    async hydrate(index) {
      const item = (this.data.items || [])[index]
      if (!item) return
      try {
        const resolved = await media.resolveUrls([item.src])
        const displaySrc = (resolved && resolved[0]) || item.src
        const info = await this.probe(displaySrc)
        const ratio = info.height && info.width ? info.height / info.width : 1
        const isLong = ratio >= LONG_RATIO
        const boxStyle = this.data.countClass === 'one'
          ? this.oneBoxStyle(info.width, info.height, isLong)
          : ''
        this.setData({
          [`items[${index}].displaySrc`]: displaySrc,
          [`items[${index}].status`]: 'ok',
          [`items[${index}].isLong`]: isLong,
          [`items[${index}].boxStyle`]: boxStyle
        })
      } catch (err) {
        this.setData({ [`items[${index}].status`]: 'fail' })
      }
    },

    probe(src) {
      return new Promise((resolve) => {
        wx.getImageInfo({
          src,
          success: (res) => resolve({ width: res.width || 0, height: res.height || 0 }),
          fail: () => resolve({ width: 0, height: 0 })
        })
      })
    },

    onTap(e) {
      const index = Number(e.currentTarget.dataset.index)
      const item = (this.data.items || [])[index]
      if (!item || item.status === 'fail') return
      const urls = (this.data.items || []).map((one) => one.displaySrc || one.src)
      const current = item.displaySrc || item.src
      this.triggerEvent('preview', { index, current, urls, identity: item.index })
      media.previewImages(current, urls)
    },

    onImgLoad(e) {
      const index = Number(e.currentTarget.dataset.index)
      if (Number.isNaN(index)) return
      if ((this.data.items[index] || {}).status !== 'ok') {
        this.setData({ [`items[${index}].status`]: 'ok' })
      }
    },

    onImgError(e) {
      const index = Number(e.currentTarget.dataset.index)
      if (Number.isNaN(index)) return
      this.setData({ [`items[${index}].status`]: 'fail' })
    },

    onRetry(e) {
      const index = Number(e.currentTarget.dataset.index)
      if (Number.isNaN(index)) return
      this.setData({ [`items[${index}].status`]: 'loading' })
      this.hydrate(index)
    }
  }
})
