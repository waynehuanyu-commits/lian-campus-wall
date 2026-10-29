// 企微群推送前的内容分级（只影响「推不推进群」，不影响帖子在小程序里的展示）。
// 词库沿用 utils/moderation.js，帖子已经过机审/人审，这里是第二道、更保守的「群里不扩散」过滤：
// - risk：涉政、代课代考、诈骗借贷、赌博色情、辱骂仇恨、挂人曝光等 → 不推，留在小程序里
// - disputed：传闻、隐私对象、思政语境、学业暗语、被举报过 → 发企微消息给确认人，谁先确认按谁的
// - ok：直接进下一批推送

const moderation = require('../../utils/moderation')

const RISK_SIGNALS = {
  politics_entity: '涉政',
  politics_attack: '涉政',
  politics_highrisk: '涉政',
  academic_core: '代课代考',
  fraud_core: '诈骗',
  fraud_recruit: '诈骗',
  fraud_lend: '借贷套现',
  gambling_core: '赌博',
  adult_core: '色情',
  dating_solicit: '约会引流',
  adult_hint: '色情擦边',
  abuse_core: '辱骂',
  hate_core: '极端仇恨',
  voyeur_privacy: '偷拍隐私',
  rebate_promo: '返利引流',
  violence_call: '行动号召',
  official_impersonate: '冒充官方',
  serious_accusation: '严重指控',
  doxx_intent: '挂人曝光'
}

// 词库归一化会把「帮签」并成「qd」后连写，导致漏判；推送这里按原文再兜一次底
const ACADEMIC_RAW = /帮签|代签|替签|代上课|帮上课|代写作业|代做作业/

const DISPUTED_SIGNALS = {
  rumor_marker: '传闻',
  privacy_target: '涉及他人隐私',
  politics_context: '思政相关',
  academic_variant: '疑似学业暗语'
}

function hitLabels(signals, table) {
  return Object.keys(table)
    .filter((key) => Array.isArray(signals[key]) && signals[key].length)
    .map((key) => `${table[key]}（${signals[key].slice(0, 2).join('、')}）`)
}

/** 返回 { level: 'ok' | 'disputed' | 'risk', reasons: [] } */
function classifyForPush(post) {
  if (!post) return { level: 'risk', reasons: ['帖子已不存在'] }
  if (!moderation.isPublicStatus(post.reviewStatus || 'approved')) return { level: 'risk', reasons: ['帖子当前不公开'] }
  const review = moderation.reviewText({
    title: post.title,
    content: post.content,
    extra: post.extra,
    routeFrom: post.routeFrom,
    routeTo: post.routeTo
  })
  const signals = review.signals || {}
  // 只有思政学习语境、没有攻击类词时，涉政实体降为争议
  const politicsStudyOnly = (signals.politics_context || []).length
    && !(signals.politics_attack || []).length
    && !(signals.politics_highrisk || []).length
  const riskTable = politicsStudyOnly ? { ...RISK_SIGNALS, politics_entity: undefined } : RISK_SIGNALS
  const risk = hitLabels(signals, Object.fromEntries(Object.entries(riskTable).filter(([, v]) => v)))
  const raw = `${post.title || ''}\n${post.content || ''}`
  const academic = raw.match(ACADEMIC_RAW)
  if (academic) risk.push(`代课代考（${academic[0]}）`)
  if (risk.length) return { level: 'risk', reasons: risk }
  const disputed = hitLabels(signals, DISPUTED_SIGNALS)
  if ((Number(post.reportCount) || 0) > 0) disputed.push(`被举报 ${post.reportCount} 次`)
  if (disputed.length) return { level: 'disputed', reasons: disputed }
  return { level: 'ok', reasons: [] }
}

module.exports = { classifyForPush }
