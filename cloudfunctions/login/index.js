const cloud = require('wx-server-sdk')
const defaultProfile = require('./default-profile')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function createUser(openid) {
  const now = Date.now()
  return {
    id: `u_${openid.slice(-10)}_${now.toString(36)}`,
    openid,
    nickname: defaultProfile.randomNickname(),
    avatar: defaultProfile.randomAvatar(),
    bio: '在这里遇见有趣的灵魂',
    createdAt: now,
    schoolName: '',
    schoolCampus: '',
    schoolLocked: false,
    schoolSubmittedAt: 0,
    schoolChangeRequest: null,
    showSchoolTag: false,
    studentAuthStatus: 'none',
    studentAuthImages: [],
    studentAuthNote: '',
    studentAuthSubmittedAt: 0,
    studentAuthReviewedAt: 0,
    studentAuthReviewNote: '',
    status: 'active',
    muteUntil: 0,
    banReason: '',
    bannedAt: 0,
    riskScore: 0,
    violateCount: 0
  }
}

function normalize(user) {
  if (user.status === 'muted' && user.muteUntil && user.muteUntil <= Date.now()) {
    return {
      ...user,
      status: 'active',
      muteUntil: 0,
      banReason: user.bannedAt ? user.banReason : ''
    }
  }
  return user
}

function publicUser(user) {
  const next = { ...user }
  delete next.openid
  return next
}

exports.main = async () => {
  const { OPENID } = cloud.getWXContext()
  if (!OPENID) return { ok: false, message: '未获取到登录态' }

  const col = db.collection('users')
  const found = await col.where({ openid: OPENID }).limit(1).get()
  let user = found.data[0]
  if (!user) {
    user = createUser(OPENID)
    await col.doc(user.id).set({ data: user })
  } else {
    const next = normalize(user)
    if (next.status !== user.status) {
      await col.doc(user.id || user._id).update({
        data: {
          status: next.status,
          muteUntil: next.muteUntil,
          banReason: next.banReason
        }
      })
    }
    user = { ...next, id: next.id || next._id }
    const profilePatch = defaultProfile.defaultProfilePatch(user)
    if (profilePatch) {
      await col.doc(user.id).update({ data: profilePatch })
      user = { ...user, ...profilePatch }
    }
  }

  return { ok: true, user: publicUser(user) }
}
