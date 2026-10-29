const store = require('../../utils/store')
const repo = require('../../utils/repo')
const track = require('../../utils/track')
const media = require('../../utils/media')
const { formatTime } = require('../../utils/util')

Page({
  data: {
    locked: false,
    schoolName: '',
    schoolCampus: '',
    schoolText: '',
    submittedText: '',
    studentAuthStatus: 'none',
    studentStatusText: '',
    studentStatusClass: '',
    studentReviewNote: '',
    studentImages: [],
    studentNote: ''
  },

  async onShow() {
    await (getApp().globalData.ready || Promise.resolve())
    track.pageView('school_auth')
    this.refresh()
  },

  async refresh() {
    const user = (await repo.getUser()) || {}
    const status = user.studentAuthStatus || 'none'
    this.setData({
      locked: !!user.schoolLocked,
      schoolName: user.schoolName || '',
      schoolCampus: user.schoolCampus || '',
      schoolText: store.formatSchool(user) || '未认证',
      submittedText: user.schoolSubmittedAt ? formatTime(user.schoolSubmittedAt) : '',
      studentAuthStatus: status,
      studentStatusText: store.studentAuthStatusText(status),
      studentStatusClass: status === 'approved' ? 'ok' : (status === 'rejected' ? 'danger' : ''),
      studentReviewNote: user.studentAuthReviewNote || '',
      studentImages: status === 'pending' || status === 'approved' ? (user.studentAuthImages || []) : this.data.studentImages,
      studentNote: user.studentAuthNote || this.data.studentNote
    })
  },

  onSchoolInput(e) {
    this.setData({ schoolName: e.detail.value })
  },

  onCampusInput(e) {
    this.setData({ schoolCampus: e.detail.value })
  },


  onStudentNoteInput(e) {
    this.setData({ studentNote: e.detail.value })
  },

  async chooseStudentImage() {
    const remain = 3 - this.data.studentImages.length
    if (remain <= 0) return
    try {
      const picked = await media.chooseImages({ count: remain, existing: [] })
      if (!picked.length) return
      wx.showLoading({ title: '上传中', mask: true })
      let uploaded = picked
      try {
        uploaded = await repo.uploadImages(picked)
      } catch (err) {
        uploaded = picked
      }
      wx.hideLoading()
      this.setData({ studentImages: this.data.studentImages.concat(uploaded).slice(0, 3) })
    } catch (err) {
      wx.hideLoading()
      wx.showToast({ title: '选图失败', icon: 'none' })
    }
  },

  removeStudentImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const next = this.data.studentImages.slice()
    next.splice(index, 1)
    this.setData({ studentImages: next })
  },

  previewStudentImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const urls = this.data.studentImages || []
    media.previewImages(urls[index] || urls[0], urls)
  },

  onSubmit() {
    wx.showModal({
      title: '确认提交？',
      content: '请确认学校真实有效。提交后不可修改，虚假认证可能被封禁。',
      confirmColor: '#FF6B81',
      success: async (res) => {
        if (!res.confirm) return
        const result = await repo.submitSchoolInfo({
          schoolName: this.data.schoolName,
          schoolCampus: this.data.schoolCampus
        })
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        track.authSubmit({
          surface: 'school_auth',
          authType: 'school',
          schoolName: this.data.schoolName,
          schoolCampus: this.data.schoolCampus
        })
        getApp().globalData.user = result.user
        wx.showToast({ title: '认证成功', icon: 'success' })
        this.refresh()
      }
    })
  },

  onSubmitStudent() {
    wx.showModal({
      title: '提交学生认证？',
      content: '证明照片为选填，可不上传。材料仅用于管理员核验，不会出现在公开内容中。',
      confirmColor: '#2F7DFF',
      success: async (res) => {
        if (!res.confirm) return
        const result = await repo.submitStudentAuth({
          images: this.data.studentImages,
          note: this.data.studentNote
        })
        if (!result.ok) {
          wx.showToast({ title: result.message, icon: 'none' })
          return
        }
        track.authSubmit({
          surface: 'school_auth',
          authType: 'student',
          imageCount: (this.data.studentImages || []).length
        })
        getApp().globalData.user = result.user
        wx.showToast({ title: '已提交审核', icon: 'success' })
        this.refresh()
      }
    })
  }
})
