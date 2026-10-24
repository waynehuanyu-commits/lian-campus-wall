// 黎安校园墙微信二维码卡片：详情页、消息页底部引流
Component({
  properties: {
    src: { type: String, value: '/images/campus-wechat-qr.png' },
    avatar: { type: String, value: '/images/campus-wall-avatar.jpg' }
  },

  methods: {
    onPreview() {
      const url = this.data.src
      if (!url) return
      wx.previewImage({ urls: [url], current: url, showmenu: true })
    }
  }
})
