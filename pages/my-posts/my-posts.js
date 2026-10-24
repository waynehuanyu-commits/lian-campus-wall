const repo = require('../../utils/repo')
const store = require('../../utils/store')
const homeFeed = require('../../utils/home-feed')
const defaultProfile = require('../../utils/default-profile')
const media = require('../../utils/media')
const postNav = require('../../utils/post-nav')
const { formatTime } = require('../../utils/util')

function feedBodyOverflows(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').trim()
  if (!raw) return false
  let lines = 0
  raw.split('\n').forEach((line) => {
    lines += Math.max(1, Math.ceil(Array.from(line).length / 24))
  })
  return lines > 3
}

Page({
  data: {
    topics: ['全部', store.OFFICIAL_TOPIC, ...store.HOME_TOPICS, store.OTHER_TOPIC],
    topic: '全部',
    posts: [],
    loading: true,
    loadError: ''
  },

  onShow() {
    this.loadList()
  },

  onTopicTap(e) {
    const topic = store.normalizeTopic(e.currentTarget.dataset.name)
    if (!topic || topic === this.data.topic) return
    this.setData({ topic }, () => this.render())
  },

  async loadList() {
    if (!(this.data.posts || []).length) this.setData({ loading: true, loadError: '' })
    try {
      const [forum, wall] = await Promise.all([
        repo.myPosts('forum'),
        repo.myPosts('wall')
      ])
      const raw = []
      ;(forum || []).forEach((item) => raw.push({ ...item, contentType: 'forum' }))
      ;(wall || []).forEach((item) => raw.push({ ...item, contentType: 'wall' }))
      raw.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      this._raw = raw
      this.render()
    } catch (err) {
      this.setData({
        posts: [],
        loading: false,
        loadError: (err && err.message) || '加载失败'
      })
    }
  },

  render() {
    const topic = this.data.topic
    const list = (this._raw || []).filter((item) => homeFeed.topicMatches(item, item.contentType, topic))
    this.setData({
      posts: this.mapPosts(list),
      loading: false,
      loadError: ''
    })
  },

  mapPosts(list) {
    const open = this._bodyOpen || {}
    return (list || []).map((item, index) => {
      const contentType = item.contentType === 'wall' ? 'wall' : 'forum'
      const id = String(item.id || item._id || '').trim()
      if (!id) return null
      const feedKey = `${contentType}:${id}`
      const bodyText = String(item.content || '').trim()
      const title = String(item.title || item.headline || '').trim()
      const titleAsBody = !!title && !!bodyText && (
        bodyText === title || bodyText.indexOf(title) === 0 || title === bodyText.replace(/\s+/g, ' ').slice(0, 40)
      )
      const pending = item.reviewStatus && item.reviewStatus !== 'approved'
      return {
        ...item,
        id,
        contentType,
        feedKey,
        uniq: `${feedKey}:${index}`,
        displayTag: item.displayTag || homeFeed.primaryTag(item, contentType),
        images: item.images || [],
        timeText: formatTime(item.createdAt),
        bodyText,
        showTitle: !!title && !titleAsBody,
        bodyLong: feedBodyOverflows(bodyText),
        bodyOpen: !!open[feedKey],
        viewCount: Number(item.viewCount) || 0,
        reviewLabel: pending ? (item.reviewStatusLabel || '审核中') : '',
        authorName: defaultProfile.resolveAuthorName(item.authorName, item.authorId || id, {
          anonymous: !!item.anonymous
        }),
        authorAvatar: defaultProfile.resolveAuthorAvatar(
          item.authorAvatar,
          item.anonymous || item.authorName === '匿名同学' ? id : (item.authorId || id),
          { anonymous: !!item.anonymous, authorName: item.authorName }
        )
      }
    }).filter(Boolean)
  },

  toggleBody(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const type = e.currentTarget.dataset.type === 'wall' ? 'wall' : 'forum'
    const key = `${type}:${id}`
    if (!id) return
    if (!this._bodyOpen) this._bodyOpen = {}
    this._bodyOpen[key] = !this._bodyOpen[key]
    const index = (this.data.posts || []).findIndex((item) => item.feedKey === key)
    if (index < 0) return
    this.setData({ [`posts[${index}].bodyOpen`]: !!this._bodyOpen[key] })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    const type = e.currentTarget.dataset.type === 'forum' ? 'forum' : 'wall'
    postNav.openPostDetail(type, id)
  },

  async onLike(e) {
    const id = String(e.currentTarget.dataset.id || '')
    const type = e.currentTarget.dataset.type === 'wall' ? 'wall' : 'forum'
    if (!id || this._likingId) return
    const index = (this.data.posts || []).findIndex((item) => item.feedKey === `${type}:${id}`)
    const post = index >= 0 ? this.data.posts[index] : null
    if (!post) return
    this._likingId = id
    const liked = !post.liked
    this.setData({
      [`posts[${index}].liked`]: liked,
      [`posts[${index}].likeCount`]: Math.max(0, (post.likeCount || 0) + (liked ? 1 : -1))
    })
    try {
      const result = await repo.toggleLike(type, id)
      if (!result || result.ok === false) throw new Error((result && result.message) || '点赞失败')
    } catch (err) {
      this.setData({
        [`posts[${index}].liked`]: post.liked,
        [`posts[${index}].likeCount`]: post.likeCount
      })
      wx.showToast({ title: (err && err.message) || '点赞失败', icon: 'none' })
    }
    this._likingId = ''
  },

  previewImage(e) {
    const postId = e.currentTarget.dataset.postid
    const type = e.currentTarget.dataset.type === 'wall' ? 'wall' : 'forum'
    const index = Number(e.currentTarget.dataset.index)
    const post = (this.data.posts || []).find((item) => item.feedKey === `${type}:${postId}`)
    const urls = (post && post.images) || []
    const current = urls[index] || urls[0]
    media.previewImages(current, urls)
  },

  preventBubble() {}
})
