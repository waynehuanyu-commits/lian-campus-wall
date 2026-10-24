const repo = require('../../utils/repo')
const media = require('../../utils/media')
const posterDraw = require('../../utils/poster-draw')
const share = require('../../utils/share')
const defaultProfile = require('../../utils/default-profile')
const { uid } = require('../../utils/util')

function miniEnvVersion() {
  try {
    const info = wx.getAccountInfoSync()
    const env = info && info.miniProgram && info.miniProgram.envVersion
    if (env === 'develop' || env === 'trial' || env === 'release') return env
  } catch (err) {
    // 取不到时由云函数按正式版生成
  }
  return ''
}

function authText(err) {
  return String((err && (err.errMsg || err.message || err.code || err.errno)) || err || '')
}

function isPrivacyScopeError(err) {
  return /privacy|api scope|隐私|privacy api banned/i.test(authText(err))
}

function isAuthDeny(err) {
  return /auth deny|authorize:fail|permission denied|AUTH_DENIED|authorize denied|access denied/i.test(authText(err))
    && !isPrivacyScopeError(err)
}

function isFileSaveError(err) {
  return /3302|file type|invalid file|no such file|not exist|fail save|errno:\s*2\b/i.test(authText(err))
}

function isIOS() {
  try {
    const info = wx.getSystemInfoSync()
    return !!(info && (info.platform === 'ios' || /ios/i.test(info.system || '')))
  } catch (err) {
    return false
  }
}

function compareVersion(v1, v2) {
  const a = String(v1 || '').split('.').map((n) => Number(n) || 0)
  const b = String(v2 || '').split('.').map((n) => Number(n) || 0)
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0
    const y = b[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

Page({
  data: {
    status: 'loading',
    errorTitle: '',
    errorDesc: '',
    localPath: '',
    shareUrl: '',
    busy: false,
    saving: false,
    shareTip: ''
  },

  onLoad(query) {
    const q = query || {}
    this.postSource = (q.source === 'wall' || q.type === 'wall') ? 'wall' : 'forum'
    this.postId = String(q.id || q.postId || q.contentId || '').trim()
    if (this.postId === 'undefined' || this.postId === 'null') this.postId = ''
    this.requestId = uid('sp_')
    this.alive = true
    this.meta = null
    this.localPath = ''
    this.shareUrl = ''
    this.fileId = ''
    this.publishError = ''
    share.enableMenus()
    if (!this.postId) {
      this.setData({
        status: 'error',
        errorTitle: '内容暂不可生成分享图',
        errorDesc: '缺少帖子 id'
      })
      return
    }
    this.generate()
  },

  onUnload() {
    this.alive = false
    this.requestId = ''
  },

  onRetry() {
    this.requestId = uid('sp_')
    this.generate()
  },

  async generate() {
    const requestId = this.requestId
    this.setData({
      status: 'loading',
      errorTitle: '',
      errorDesc: '',
      localPath: '',
      shareUrl: '',
      busy: true,
      shareTip: ''
    })
    try {
      const result = await repo.generateSharePoster({
        postSource: this.postSource,
        postId: this.postId,
        requestId,
        envVersion: miniEnvVersion()
      })
      if (!this.alive || requestId !== this.requestId) return
      if (!result || !result.ok) {
        this.setData({
          status: 'error',
          errorTitle: (result && result.message) || '生成失败，请重试',
          errorDesc: '',
          busy: false
        })
        return
      }
      const publicPost = result.publicPost || {}
      if (!publicPost.authorAvatar) {
        publicPost.authorAvatar = defaultProfile.resolveAuthorAvatar('', publicPost.id || this.postId, {
          anonymous: !!publicPost.anonymous,
          authorName: publicPost.authorName
        })
      }
      const code = result.originalPostCode || {}
      const downloads = await Promise.all([
        code.fileId ? this.resolveLocal(code.fileId) : Promise.resolve(''),
        publicPost.firstImage ? this.resolveLocal(publicPost.firstImage) : Promise.resolve(''),
        publicPost.authorAvatar ? this.resolveLocal(publicPost.authorAvatar) : Promise.resolve('')
      ])
      if (!this.alive || requestId !== this.requestId) return
      const [codeLocalPath, firstImageLocalPath, avatarLocalPath] = downloads
      if (!codeLocalPath && !code.localDemo) {
        throw new Error('原帖码加载失败')
      }
      if (publicPost.firstImage && !firstImageLocalPath) {
        throw new Error('首图加载失败')
      }
      const localPath = await this.renderPoster({
        publicPost,
        codeLocalPath: codeLocalPath || '',
        firstImageLocalPath,
        avatarLocalPath,
        localDemo: !!code.localDemo
      })
      if (!this.alive || requestId !== this.requestId) return
      this.meta = {
        postSource: result.postSource || this.postSource,
        postId: result.postId || this.postId,
        postRevision: result.postRevision,
        templateVersion: result.templateVersion,
        requestId,
        detailPath: this.postSource === 'wall'
          ? `pages/wall-detail/wall-detail?id=${this.postId}`
          : `pages/forum-detail/forum-detail?id=${this.postId}`
      }
      this.localPath = localPath
      const published = await this.publishPoster(localPath)
      if (!this.alive || requestId !== this.requestId) return
      this.shareUrl = published.url
      this.fileId = published.fileId
      this.publishError = published.error
      this.setData({
        status: 'ready',
        localPath,
        shareUrl: published.url,
        busy: false,
        shareTip: published.url
          ? ''
          : (published.error || '图片还在本地，转发菜单会是灰的')
      })
    } catch (err) {
      if (!this.alive || requestId !== this.requestId) return
      this.setData({
        status: 'error',
        errorTitle: '生成失败，请重试',
        errorDesc: (err && err.message) || '',
        busy: false
      })
    }
  },

  async resolveLocal(src) {
    const raw = String(src || '').trim()
    if (!raw) return ''
    if (raw.startsWith('wxfile://') || raw.startsWith('/images/')) return raw
    try {
      const list = await media.resolveUrls([raw])
      return (list && list[0]) || ''
    } catch (err) {
      return ''
    }
  },

  renderPoster(payload) {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery()
      query.select('#sharePosterCanvas')
        .fields({ node: true, size: true })
        .exec(async (res) => {
          try {
            const canvas = res && res[0] && res[0].node
            if (!canvas) {
              reject(new Error('画布不可用'))
              return
            }
            await posterDraw.drawSharePoster(canvas, payload)
            const path = await posterDraw.canvasToTempFile(canvas)
            resolve(path)
          } catch (err) {
            reject(err || new Error('渲染失败'))
          }
        })
    })
  },

  canShowShareMenu() {
    try {
      const info = wx.getSystemInfoSync()
      return typeof wx.showShareImageMenu === 'function'
        && compareVersion(info.SDKVersion, '2.14.3') >= 0
    } catch (err) {
      return typeof wx.showShareImageMenu === 'function'
    }
  },

  async ensureValid() {
    if (!this.meta || !this.localPath) return { ok: false, message: '请先生成分享图' }
    const result = await repo.validateSharePoster({
      postSource: this.meta.postSource,
      postId: this.meta.postId,
      postRevision: this.meta.postRevision
    })
    if (!result || result.ok === false) {
      return { ok: false, message: (result && result.message) || '校验失败' }
    }
    if (!result.canSave) {
      return { ok: false, message: result.reason || '帖子内容已更新，请重新生成', stale: true }
    }
    return { ok: true }
  },

  async publishPoster(localPath) {
    try {
      const uploaded = await repo.uploadImages([localPath], 'posters')
      const fileId = uploaded && uploaded[0]
      if (!fileId || !String(fileId).startsWith('cloud://')) {
        return { fileId: '', url: '', error: '云存储没返回图片' }
      }
      const url = await new Promise((resolve, reject) => {
        wx.cloud.getTempFileURL({
          fileList: [fileId],
          success: (res) => {
            const item = (res.fileList && res.fileList[0]) || {}
            if (item.status && Number(item.status) !== 0) {
              reject(new Error(item.errMsg || '临时链接失败'))
              return
            }
            resolve(item.tempFileURL || '')
          },
          fail: reject
        })
      })
      if (!/^https:\/\//.test(url)) {
        return { fileId, url: '', error: '没拿到网络图片地址' }
      }
      return { fileId, url, error: '' }
    } catch (err) {
      const message = String((err && (err.errMsg || err.message)) || '上传失败')
      return { fileId: '', url: '', error: message }
    }
  },

  onShareAppMessage() {
    const detailPath = (this.meta && this.meta.detailPath) || 'pages/forum/forum'
    return {
      title: '黎安话事',
      path: detailPath.charAt(0) === '/' ? detailPath : `/${detailPath}`
    }
  },

  onShareTimeline() {
    const detailPath = (this.meta && this.meta.detailPath) || ''
    const query = detailPath.indexOf('?') >= 0 ? detailPath.slice(detailPath.indexOf('?') + 1) : ''
    return { title: '黎安话事', query }
  },

  onPreview() {
    const current = this.localPath || this.shareUrl
    if (!current || this.data.status !== 'ready') return
    wx.previewImage({
      current,
      urls: [current],
      showmenu: false
    })
  },

  async ensureShareUrl() {
    let shareUrl = this.shareUrl || this.data.shareUrl || ''
    if (/^https:\/\//i.test(shareUrl)) return shareUrl
    if (!this.localPath) return ''
    wx.showLoading({ title: '准备转发', mask: true })
    const published = await this.publishPoster(this.localPath)
    wx.hideLoading()
    if (!this.alive) return ''
    this.shareUrl = published.url || ''
    this.fileId = published.fileId || ''
    this.publishError = published.error || ''
    this.setData({
      shareUrl: this.shareUrl,
      shareTip: this.shareUrl
        ? ''
        : (published.error || '图片上传失败，可先保存到相册')
    })
    return this.shareUrl
  },

  downloadSharePath(url) {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url,
        success: (res) => {
          const path = res && res.tempFilePath
          if (path && (!res.statusCode || res.statusCode === 200)) {
            resolve(path)
            return
          }
          reject(new Error('下载分享图失败'))
        },
        fail: (err) => reject(err || new Error('下载分享图失败'))
      })
    })
  },

  async onShareImage() {
    if (this.data.busy || this.data.saving || this.data.status !== 'ready' || !this.localPath) return
    const check = await this.ensureValid()
    if (!this.alive) return
    if (!check.ok) {
      wx.showToast({ title: check.message || '请重新生成', icon: 'none' })
      if (check.stale) this.onRetry()
      return
    }
    if (!this.canShowShareMenu()) {
      wx.showToast({ title: '转发菜单不可用，可先保存图片', icon: 'none' })
      return
    }
    // 菜单里的「保存图片」没有回调。没授权时微信只提示「暂无图片保存权限」。
    const allowed = await this.ensureAlbumPermission()
    if (!this.alive || !allowed) return
    // 微信要求：必须先 downloadFile(https)，再用返回的临时路径打开菜单；
    // 画布本地路径 / cloud.downloadFile 都会导致「发送给朋友」变灰。
    try {
      this.setData({ busy: true })
      const shareUrl = await this.ensureShareUrl()
      if (!this.alive) return
      if (!/^https:\/\//i.test(shareUrl)) {
        wx.showToast({ title: '转发菜单不可用，可先保存图片', icon: 'none' })
        return
      }
      wx.showLoading({ title: '打开转发', mask: true })
      const path = await this.downloadSharePath(shareUrl)
      wx.hideLoading()
      if (!this.alive) return
      this.openImageMenu(path)
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '转发菜单不可用，可先保存图片', icon: 'none' })
    } finally {
      if (this.alive) this.setData({ busy: false })
    }
  },

  openImageMenu(path) {
    if (!path) {
      wx.showToast({ title: '转发菜单不可用，可先保存图片', icon: 'none' })
      return
    }
    // 基础库 3.8.2 起入口默认打开，且 entrancePath 上的参数会被丢掉。
    // 长按识码必须走图里的小程序码，码的 path 自带帖子 id。
    wx.showShareImageMenu({
      path,
      needShowEntrance: false,
      fail: () => {
        wx.showToast({ title: '转发菜单不可用，可先保存图片', icon: 'none' })
      }
    })
  },

  onShow() {
    if (!this._pendingSaveAfterSetting) return
    this._pendingSaveAfterSetting = false
    if (this.data.status === 'ready' && this.localPath) {
      this.onSave({ fromSetting: true })
    }
  },

  async onSave(options) {
    const fromSetting = !!(options && options.fromSetting)
    if (this.data.busy || this.data.saving || this.data.status !== 'ready') return
    const check = await this.ensureValid()
    if (!check.ok) {
      wx.showToast({ title: check.message || '请重新生成', icon: 'none' })
      if (check.stale) this.onRetry()
      return
    }
    const allowed = await this.ensureAlbumPermission({ fromSetting })
    if (!this.alive || !allowed) return
    this.setData({ saving: true, busy: true })
    try {
      await this.saveToAlbum(this.localPath)
      if (!this.alive) return
      wx.showToast({ title: '已保存到相册', icon: 'success' })
    } catch (err) {
      if (!this.alive) return
      await this.handleSaveError(err, fromSetting)
    }
    if (this.alive) this.setData({ saving: false, busy: false })
  },

  requirePrivacyAgree() {
    return new Promise((resolve) => {
      if (typeof wx.getPrivacySetting !== 'function') {
        resolve(true)
        return
      }
      wx.getPrivacySetting({
        success: (res) => {
          if (!res || !res.needAuthorization) {
            resolve(true)
            return
          }
          if (typeof wx.requirePrivacyAuthorize !== 'function') {
            resolve(false)
            return
          }
          wx.requirePrivacyAuthorize({
            success: () => resolve(true),
            fail: () => resolve(false)
          })
        },
        fail: () => resolve(true)
      })
    })
  },

  async ensureAlbumPermission(options) {
    const fromSetting = !!(options && options.fromSetting)
    const privacyOk = await this.requirePrivacyAgree()
    if (!privacyOk) {
      wx.showToast({ title: '需同意隐私协议后才能保存', icon: 'none' })
      return false
    }
    const flag = await this.getAlbumAuth()
    // 只有用户明确拒绝过小程序相册权限，才去设置；否则交给保存接口弹系统框。
    if (flag === false) {
      if (!fromSetting) this.askAlbumPermission('mini')
      else wx.showToast({ title: '请打开「添加到相册」后再返回', icon: 'none' })
      return false
    }
    if (flag === true || isIOS()) return true
    try {
      await this.requestAlbumAuth()
      return true
    } catch (err) {
      if (isPrivacyScopeError(err)) {
        this.showPrivacyAlbumHelp()
        return false
      }
      const again = await this.getAlbumAuth()
      if (again === false) {
        if (!fromSetting) this.askAlbumPermission('mini')
        return false
      }
      return true
    }
  },

  async handleSaveError(err, fromSetting) {
    if (isPrivacyScopeError(err)) {
      this.showPrivacyAlbumHelp()
      return
    }
    if (isAuthDeny(err)) {
      if (fromSetting) {
        this.askAlbumPermission(this.getAppAlbumAuth() === 'denied' ? 'system' : 'mini')
        return
      }
      await this.promptAlbumDeny()
      return
    }
    if (isFileSaveError(err)) {
      wx.showToast({ title: '图片格式异常，请重新生成后再保存', icon: 'none' })
      return
    }
    const detail = authText(err).slice(0, 80)
    wx.showModal({
      title: '保存失败',
      content: detail
        ? `保存没有成功。${detail}`
        : '保存没有成功，请重试。若是 iPhone，请到「设置 → 微信 → 照片」选择「添加照片」。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  async promptAlbumDeny() {
    const miniFlag = await this.getAlbumAuth()
    if (miniFlag === false) {
      this.askAlbumPermission('mini')
      return
    }
    if (isIOS() && this.getAppAlbumAuth() === 'denied') {
      this.askAlbumPermission('system')
      return
    }
    if (isIOS()) {
      this.askAlbumPermission('system')
      return
    }
    wx.showToast({ title: '未获得相册权限', icon: 'none' })
  },

  showPrivacyAlbumHelp() {
    wx.showModal({
      title: '还不能写入相册',
      content: '小程序后台的用户隐私保护指引里还没声明「相册（仅写入）」。开发者：微信公众平台 → 设置 → 用户隐私保护指引 → 添加该项并保存发布。改完后重新打开小程序再保存。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  askAlbumPermission(kind) {
    const system = kind === 'system'
    wx.showModal({
      title: '需要相册权限',
      content: system
        ? 'iPhone 请打开「设置 → 微信 → 照片」，选择「所有照片」或「添加照片」。不要选「无」或「选中的照片」。改完返回后会自动再保存一次。'
        : '请打开「添加到相册」。iPhone 若列表里没有这一项，请到手机「设置 → 微信 → 照片」选择「添加照片」。返回后会自动再保存一次。',
      confirmText: '去设置',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return
        this._pendingSaveAfterSetting = true
        if (system && typeof wx.openAppAuthorizeSetting === 'function') {
          wx.openAppAuthorizeSetting({
            fail: () => {
              this._pendingSaveAfterSetting = false
              wx.showToast({ title: '请手动打开：设置 → 微信 → 照片', icon: 'none' })
            }
          })
          return
        }
        wx.openSetting({
          success: (setting) => {
            const ok = setting && setting.authSetting && setting.authSetting['scope.writePhotosAlbum']
            if (!ok) return
            this._pendingSaveAfterSetting = false
            if (this.localPath) this.onSave({ fromSetting: true })
          },
          fail: () => {
            this._pendingSaveAfterSetting = false
          }
        })
      }
    })
  },

  getAppAlbumAuth() {
    try {
      if (typeof wx.getAppAuthorizeSetting !== 'function') return ''
      const setting = wx.getAppAuthorizeSetting() || {}
      return String(setting.albumAuthorized || '')
    } catch (err) {
      return ''
    }
  },

  getAlbumAuth() {
    return new Promise((resolve) => {
      wx.getSetting({
        success: (res) => {
          const flag = res && res.authSetting ? res.authSetting['scope.writePhotosAlbum'] : undefined
          resolve(flag)
        },
        fail: () => resolve(undefined)
      })
    })
  },

  requestAlbumAuth() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: 'scope.writePhotosAlbum',
        success: () => resolve(true),
        fail: (err) => reject(err || new Error('authorize fail'))
      })
    })
  },

  ensureAlbumFile(filePath) {
    return new Promise((resolve) => {
      const src = String(filePath || '').trim()
      if (!src) {
        resolve('')
        return
      }
      const root = wx.env && wx.env.USER_DATA_PATH
      const fsm = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null
      // iPhone 对无后缀临时路径很挑，统一落到带 .png 的本地文件再存。
      if (!root || !fsm || (!isIOS() && /\.(png|jpe?g|gif|webp)$/i.test(src))) {
        resolve(src)
        return
      }
      const dest = `${root}/share_poster_${Date.now()}.png`
      const finish = (path) => resolve(path || src)
      if (typeof fsm.copyFile === 'function') {
        fsm.copyFile({
          srcPath: src,
          destPath: dest,
          success: () => finish(dest),
          fail: () => {
            fsm.readFile({
              filePath: src,
              success: (res) => {
                fsm.writeFile({
                  filePath: dest,
                  data: res.data,
                  success: () => finish(dest),
                  fail: () => finish(src)
                })
              },
              fail: () => finish(src)
            })
          }
        })
        return
      }
      finish(src)
    })
  },

  saveImagePath(filePath) {
    return new Promise((resolve, reject) => {
      if (!filePath) {
        reject(new Error('missing file'))
        return
      }
      wx.saveImageToPhotosAlbum({
        filePath,
        success: resolve,
        fail: (err) => reject(err || new Error('save fail'))
      })
    })
  },

  async saveToAlbum(filePath) {
    if (!filePath) throw new Error('missing file')
    const local = await this.ensureAlbumFile(filePath)
    let lastErr = null
    const tryPaths = [local, filePath].filter((item, index, list) => item && list.indexOf(item) === index)
    for (let i = 0; i < tryPaths.length; i += 1) {
      try {
        await this.saveImagePath(tryPaths[i])
        return
      } catch (err) {
        lastErr = err
        if (isPrivacyScopeError(err) || isAuthDeny(err)) throw err
      }
    }
    let url = this.shareUrl || this.data.shareUrl || ''
    if (!/^https:\/\//i.test(url)) {
      try {
        url = await this.ensureShareUrl()
      } catch (err) {
        url = ''
      }
    }
    if (/^https:\/\//i.test(url)) {
      const downloaded = await this.downloadSharePath(url)
      const networkPath = await this.ensureAlbumFile(downloaded)
      await this.saveImagePath(networkPath || downloaded)
      return
    }
    throw lastErr || new Error('save fail')
  }
})
