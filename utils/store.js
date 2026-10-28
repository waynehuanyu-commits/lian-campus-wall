const { uid, formatDateTime } = require('./util')
const distribute = require('./distribute')
const security = require('./security')
const moderation = require('./moderation')
const homeFeed = require('./home-feed')
const sharePoster = require('./share-poster')
const defaultProfile = require('./default-profile')

const KEYS = {
  USER: 'cw_user',
  FORUM_POSTS: 'cw_forum_posts',
  WALL_POSTS: 'cw_wall_posts',
  COMMENTS: 'cw_comments',
  LIKES: 'cw_likes',
  SCHOOL_REQUESTS: 'cw_school_requests',
  DISTRIBUTE_TARGETS: 'cw_distribute_targets',
  DISTRIBUTE_LOGS: 'cw_distribute_logs',
  DIGEST_QUEUE: 'cw_digest_queue',
  DIGESTS: 'cw_digests',
  WEEKLY_HOT: 'cw_weekly_hot',
  FILTER_KEYWORDS: 'cw_filter_keywords',
  ACCOUNTS: 'cw_accounts',
  SECURITY_LOGS: 'cw_security_logs',
  RATE_BUCKETS: 'cw_rate_buckets',
  CONTACT_VIEWS: 'cw_contact_views',
  CONTACT_FEEDBACKS: 'cw_contact_feedbacks',
  CONVERSATIONS: 'cw_conversations',
  DM_MESSAGES: 'cw_dm_messages',
  LEXICONS: 'cw_lexicons',
  LEXICON_META: 'cw_lexicon_meta',
  LIKE_META: 'cw_like_meta',
  REPORTS: 'cw_reports',
  GUIDES: 'cw_guides_v2',
  INITIALIZED: 'cw_initialized_v12'
}

const CONTACT_FEEDBACK_REASONS = [
  { id: 'reliable', label: '对方靠谱' },
  { id: 'no_reply', label: '加了未回复' },
  { id: 'bad_attitude', label: '态度不好' },
  { id: 'scam_suspected', label: '疑似诈骗' },
  { id: 'other', label: '其他' }
]

const REPORT_REASONS = [
  { id: 'spam', label: '广告引流 / 刷单返利' },
  { id: 'fraud', label: '疑似诈骗 / 借贷博彩' },
  { id: 'abuse', label: '辱骂 / 人身攻击' },
  { id: 'porn', label: '色情低俗' },
  { id: 'privacy', label: '偷拍 / 隐私曝光' },
  { id: 'hate', label: '仇恨 / 暴力极端' },
  { id: 'other', label: '其他违规' }
]

const { REPORT_THRESHOLD } = require('./report-rules')

const DIGEST_SIZE = 10

const FORUM_CATEGORIES = ['校园生活', '学习交流', '吐槽树洞', '活动组队']
const WALL_BOARDS = ['二手闲置流转', '出行拼车', '拼单互助', '求物求助', '失物招领']
const SECTION_LABELS = { forum: '学习分享', wall: '互助广场' }

function sectionLabel(type) {
  return type === 'forum' ? SECTION_LABELS.forum : SECTION_LABELS.wall
}

function isForumSectionTab(tab) {
  return tab === 'forum' || tab === '论坛' || tab === '园区论坛' || tab === '学习分享'
}

function isWallSectionTab(tab) {
  return tab === 'wall' || tab === '校园墙' || tab === '互助广场'
}
const WALL_TAGS = WALL_BOARDS
const WALL_DEAL_STATUSES = [
  { id: 'open', label: '进行中' },
  { id: 'received', label: '已收到' },
  { id: 'done', label: '已成交' },
  { id: 'closed', label: '已关闭' }
]

function wallDealStatusLabel(status) {
  const hit = WALL_DEAL_STATUSES.find((item) => item.id === status)
  return hit ? hit.label : '进行中'
}

function normalizeWallDealStatus(status) {
  if (WALL_DEAL_STATUSES.some((item) => item.id === status)) return status
  return 'open'
}
const CONTACT_TYPES = [
  { id: 'wechat', label: '微信号' }
]

function needsWallContact(tag) {
  return moderation.needsWallContact(tag)
}

function contactTypeLabel() {
  return '微信号'
}

function validateWallContact(type, value, tag) {
  return moderation.validateWallContact(type, value, tag)
}
function nowMinus(hours) {
  return Date.now() - hours * 3600 * 1000
}

function seedData() {
  const demoUsers = [
    { id: 'u_demo1', nickname: '晚风吹过操场', avatar: defaultProfile.stableAvatar('u_demo1'), schoolName: '武汉大学', schoolCampus: '文理学部' },
    { id: 'u_demo2', nickname: '图书馆三楼靠窗', avatar: defaultProfile.stableAvatar('u_demo2'), schoolName: '武汉大学', schoolCampus: '信息学部' },
    { id: 'u_demo3', nickname: '热心学长', avatar: defaultProfile.stableAvatar('u_demo3'), schoolName: '华中科技大学', schoolCampus: '' },
    { id: 'u_demo4', nickname: '匿名小透明', avatar: defaultProfile.stableAvatar('u_demo4'), schoolName: '武汉大学', schoolCampus: '' }
  ]

  const forumPosts = [
    {
      id: 'f_1',
      category: '校园生活',
      title: '食堂二楼新出的杨枝甘露，真的绝',
      content: '今天中午去食堂二楼，新开的甜品窗口排队好长。杨枝甘露椰香很足，芒果也新鲜，推荐下午三点之后去，不用排那么久。有没有同学一起探店？',
      images: [],
      authorId: demoUsers[0].id,
      authorName: demoUsers[0].nickname,
      authorAvatar: demoUsers[0].avatar,
      authorSchool: '武汉大学 · 文理学部',
      anonymous: false,
      createdAt: nowMinus(2),
      likeCount: 18,
      commentCount: 4,
      viewCount: 126
    },
    {
      id: 'f_2',
      category: '学习交流',
      title: '高数期中复习资料共享，自取不谢',
      content: '整理了一份高数上下册的错题和公式速记，覆盖极限、导数、积分和级数。需要的同学评论区留一下，我发网盘。也欢迎补充你们觉得好用的资料～',
      images: [],
      authorId: demoUsers[1].id,
      authorName: demoUsers[1].nickname,
      authorAvatar: demoUsers[1].avatar,
      authorSchool: '武汉大学 · 信息学部',
      anonymous: false,
      createdAt: nowMinus(8),
      likeCount: 42,
      commentCount: 2,
      viewCount: 310
    },
    {
      id: 'f_3',
      category: '活动组队',
      title: '周末羽毛球场还差两人，来者不拒',
      content: '周六下午 3 点到 5 点，旧体育馆 3 号场。水平一般，图个开心。男生女生都行，带自己的拍子更佳，球我这边有。',
      images: [],
      authorId: demoUsers[2].id,
      authorName: demoUsers[2].nickname,
      authorAvatar: demoUsers[2].avatar,
      authorSchool: '华中科技大学',
      anonymous: false,
      createdAt: nowMinus(20),
      likeCount: 9,
      commentCount: 1,
      viewCount: 88
    },
    {
      id: 'f_4',
      category: '校园生活',
      title: '东区快递站周末取件排队也太久了',
      content: '周六下午去取了个件，排了将近四十分钟。有没有同学知道错峰时间，或者别的代收点更快点？',
      images: [],
      authorId: demoUsers[0].id,
      authorName: demoUsers[0].nickname,
      authorAvatar: demoUsers[0].avatar,
      authorSchool: '武汉大学 · 文理学部',
      anonymous: false,
      createdAt: nowMinus(36),
      likeCount: 6,
      commentCount: 0,
      viewCount: 54
    },
    {
      id: 'f_5',
      category: '吐槽树洞',
      title: '选修课点名系统也太随机了吧',
      content: '一学期就去了两次，两次都被抽中。想问问有没有同学知道这个点名是按学号哈希还是纯随机……心态有点崩。',
      images: [],
      authorId: demoUsers[3].id,
      authorName: '匿名同学',
      authorAvatar: defaultProfile.stableAvatar('f_anon'),
      authorSchool: '',
      anonymous: true,
      createdAt: nowMinus(50),
      likeCount: 31,
      commentCount: 2,
      viewCount: 240
    },
    {
      id: 'f_6',
      category: '学习交流',
      title: '求对一下概率论第三章课后题',
      content: '有几道大题答案对不上，想找同学一起核对思路，最好今晚图书馆。',
      images: [],
      authorId: demoUsers[1].id,
      authorName: demoUsers[1].nickname,
      authorAvatar: demoUsers[1].avatar,
      authorSchool: '武汉大学 · 信息学部',
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: nowMinus(0.4),
      likeCount: 0,
      commentCount: 0,
      viewCount: 4
    },
    {
      id: 'f_7',
      category: '学习交流',
      title: '有偿代考高数期末，价格好商量',
      content: '求靠谱代考，带学生证也能走。私聊谈价格。',
      images: [],
      authorId: demoUsers[3].id,
      authorName: demoUsers[3].nickname,
      authorAvatar: demoUsers[3].avatar,
      authorSchool: '武汉大学',
      anonymous: false,
      reviewStatus: 'rejected',
      reviewNote: '关键词拦截：代考',
      matchedKeywords: ['代考'],
      createdAt: nowMinus(0.2),
      likeCount: 0,
      commentCount: 0,
      viewCount: 1
    },
    {
      id: 'f_8',
      category: '学习交流',
      title: '这周课程去不了，想找人帮忙',
      content: '有偿找人代 课两节，私聊价格。',
      images: [],
      authorId: demoUsers[3].id,
      authorName: demoUsers[3].nickname,
      authorAvatar: demoUsers[3].avatar,
      authorSchool: '武汉大学',
      anonymous: false,
      reviewStatus: 'rejected',
      reviewNote: '关键词拦截：代课',
      matchedKeywords: ['代课'],
      createdAt: nowMinus(0.1),
      likeCount: 0,
      commentCount: 0,
      viewCount: 1
    }
  ]

  const wallPosts = [
    {
      id: 'w_1',
      tag: '二手闲置流转',
      title: '出一本几乎全新的《深入理解计算机系统》',
      price: '45 元 / 可小刀',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '',
      content: '大二买的，翻过前面几章，封面完好无笔记。可面交东区宿舍楼下，工作日晚上更方便。',
      images: [],
      contactType: 'wechat',
      contactValue: 'wanfeng_csapp',
      authorId: demoUsers[0].id,
      authorName: demoUsers[0].nickname,
      authorAvatar: demoUsers[0].avatar,
      authorSchool: '武汉大学 · 文理学部',
      anonymous: false,
      createdAt: nowMinus(3),
      likeCount: 12,
      commentCount: 3,
      title: '',
      price: '',
      routeFrom: '信息学部',
      routeTo: '汉口火车站',
      departTime: '周五 16:00',
      extra: '还可坐 2 人',
      content: '自己有车，顺路去汉口站。希望拼两位同学分摊油费和停车费，每人大约 20。可放一个小行李箱。',
      images: [],
      contactType: 'wechat',
      contactValue: 'hanou_ride',
      authorId: demoUsers[2].id,
      authorName: demoUsers[2].nickname,
      authorAvatar: demoUsers[2].avatar,
      authorSchool: '华中科技大学',
      anonymous: false,
      createdAt: nowMinus(8),
      likeCount: 9,
      commentCount: 2,
      viewCount: 140
    },
    {
      id: 'w_3',
      tag: '拼单互助',
      title: '拼一单水果捞，差 2 人起送',
      price: '',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '满 3 人起送 · 今天下午',
      content: '东区门口那家水果捞满 39 免配送。我点一份芒桶，还差两份。想一起的评论区报一下口味，我统一下单。',
      images: [],
      contactType: 'wechat',
      contactValue: 'lib_window3',
      authorId: demoUsers[1].id,
      authorName: demoUsers[1].nickname,
      authorAvatar: demoUsers[1].avatar,
      authorSchool: '武汉大学 · 信息学部',
      anonymous: false,
      createdAt: nowMinus(15),
      likeCount: 7,
      commentCount: 3,
      viewCount: 88
    },
    {
      id: 'w_4',
      tag: '求物求助',
      title: '求借一台科学计算器，用三天',
      price: '',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '本周三前',
      content: '期末考试要用，自己的坏了。用完当天还，可以请奶茶。住西区 5 栋，取还都方便。',
      images: [],
      contactType: 'wechat',
      contactValue: 'casio_borrow',
      authorId: demoUsers[3].id,
      authorName: demoUsers[3].nickname,
      authorAvatar: demoUsers[3].avatar,
      authorSchool: '武汉大学',
      anonymous: false,
      createdAt: nowMinus(28),
      likeCount: 15,
      commentCount: 2,
      viewCount: 173
    },
    {
      id: 'w_5',
      tag: '求物求助',
      title: '求一套黑色学士服，明天答辩应急',
      price: '',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '明天上午前',
      content: '尺码 175，用完当天还。可押学生证，也请奶茶。住西区 5 栋。',
      images: [],
      contactType: 'wechat',
      contactValue: 'wanfeng_csapp',
      authorId: demoUsers[0].id,
      authorName: demoUsers[0].nickname,
      authorAvatar: demoUsers[0].avatar,
      authorSchool: '武汉大学 · 文理学部',
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: nowMinus(0.6),
      likeCount: 0,
      commentCount: 0,
      viewCount: 6
    },
    {
      id: 'w_6',
      tag: '二手闲置流转',
      title: '出九成新 iPad 键盘保护套',
      price: '35 元',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '',
      content: '买来没用几次，适合 10.9 寸。可面交信息学部食堂门口，晚上更方便。',
      images: [],
      contactType: 'wechat',
      contactValue: 'ipad_case35',
      authorId: demoUsers[1].id,
      authorName: demoUsers[1].nickname,
      authorAvatar: demoUsers[1].avatar,
      authorSchool: '武汉大学 · 信息学部',
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: nowMinus(1.2),
      likeCount: 3,
      commentCount: 0,
      viewCount: 22
    },
    {
      id: 'w_7',
      tag: '出行拼车',
      title: '',
      price: '',
      routeFrom: '文理学部',
      routeTo: '天河机场',
      departTime: '周日 09:30',
      extra: '还可坐 1 人',
      content: '送同学去机场，回程顺路可带一位。行李舱还有空位，希望准时出发。',
      images: [],
      contactType: 'wechat',
      contactValue: 'night_ride07',
      authorId: demoUsers[2].id,
      authorName: demoUsers[2].nickname,
      authorAvatar: demoUsers[2].avatar,
      authorSchool: '华中科技大学',
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: nowMinus(2.4),
      likeCount: 5,
      commentCount: 0,
      viewCount: 41
    },
    {
      id: 'w_8',
      tag: '拼单互助',
      title: '拼蜜雪冰城外卖，还差 8 元免配',
      price: '',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '今晚 8 点前',
      content: '西区宿舍楼下取。想喝的报一下口味，我一起下单，到了群里喊。',
      images: [],
      contactType: 'wechat',
      contactValue: 'mixue_pin8',
      authorId: demoUsers[3].id,
      authorName: demoUsers[3].nickname,
      authorAvatar: demoUsers[3].avatar,
      authorSchool: '武汉大学',
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: nowMinus(3.1),
      likeCount: 4,
      commentCount: 0,
      viewCount: 33
    },
    {
      id: 'w_9',
      tag: '求物求助',
      title: '求借雨伞，今晚东图用完就还',
      price: '',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '今晚 22:00 前',
      content: '突然下雨没带伞，人在东图一楼大厅。用完马上还，请杯奶茶。',
      images: [],
      contactType: 'wechat',
      contactValue: 'print_help09',
      authorId: demoUsers[1].id,
      authorName: demoUsers[1].nickname,
      authorAvatar: demoUsers[1].avatar,
      authorSchool: '武汉大学 · 信息学部',
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: nowMinus(4.5),
      likeCount: 8,
      commentCount: 0,
      viewCount: 57
    },
    {
      id: 'w_10',
      tag: '二手闲置流转',
      title: '出一张梅园食堂餐盘优惠券',
      price: '8 折券 / 5 元',
      routeFrom: '',
      routeTo: '',
      departTime: '',
      extra: '',
      content: '有效期到月底，本人不用了。可转赠，当面扫码即可，东区面交。',
      images: [],
      contactType: 'wechat',
      contactValue: 'meiyuan_coupon',
      authorId: demoUsers[0].id,
      authorName: demoUsers[0].nickname,
      authorAvatar: demoUsers[0].avatar,
      authorSchool: '武汉大学 · 文理学部',
      anonymous: false,
      reviewStatus: 'approved',
      createdAt: nowMinus(5.2),
      likeCount: 2,
      commentCount: 0,
      viewCount: 19
    }
  ]

  const comments = [
    { id: 'c_1', targetType: 'forum', targetId: 'f_1', content: '已冲，确实好喝！', authorId: demoUsers[2].id, authorName: demoUsers[2].nickname, authorAvatar: demoUsers[2].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(1.2) },
    { id: 'c_2', targetType: 'forum', targetId: 'f_1', content: '求具体窗口名字～', authorId: demoUsers[1].id, authorName: demoUsers[1].nickname, authorAvatar: demoUsers[1].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(1) },
    { id: 'c_3', targetType: 'forum', targetId: 'f_1', content: '叫「椰椰芒芒」，靠窗那排。', authorId: demoUsers[0].id, authorName: demoUsers[0].nickname, authorAvatar: demoUsers[0].avatar, parentId: 'c_2', replyToId: 'c_2', replyToName: demoUsers[1].nickname, images: [], depth: 1, createdAt: nowMinus(0.8) },
    { id: 'c_3b', targetType: 'forum', targetId: 'f_1', content: '谢谢！这就去排队', authorId: demoUsers[1].id, authorName: demoUsers[1].nickname, authorAvatar: demoUsers[1].avatar, parentId: 'c_3', replyToId: 'c_3', replyToName: demoUsers[0].nickname, images: [], depth: 2, createdAt: nowMinus(0.6) },
    { id: 'c_4', targetType: 'forum', targetId: 'f_2', content: '太及时了，正在复习崩溃边缘。', authorId: demoUsers[0].id, authorName: demoUsers[0].nickname, authorAvatar: demoUsers[0].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(6) },
    { id: 'c_5', targetType: 'forum', targetId: 'f_2', content: '同求一份，谢谢学霸！', authorId: demoUsers[3].id, authorName: demoUsers[3].nickname, authorAvatar: demoUsers[3].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(5) },
    { id: 'c_6', targetType: 'forum', targetId: 'f_3', content: '我可以去，已私。', authorId: demoUsers[1].id, authorName: demoUsers[1].nickname, authorAvatar: demoUsers[1].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(18) },
    { id: 'c_7', targetType: 'forum', targetId: 'f_5', content: '同款倒霉蛋报道。', authorId: demoUsers[2].id, authorName: demoUsers[2].nickname, authorAvatar: demoUsers[2].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(40) },
    { id: 'c_8', targetType: 'forum', targetId: 'f_5', content: '听说是随机，别迷信学号了hhh', authorId: demoUsers[0].id, authorName: demoUsers[0].nickname, authorAvatar: demoUsers[0].avatar, parentId: 'c_7', replyToId: 'c_7', replyToName: demoUsers[2].nickname, images: [], depth: 1, createdAt: nowMinus(38) },
    { id: 'c_9', targetType: 'wall', targetId: 'w_1', content: '还在吗？我想要，今晚东区见。', authorId: demoUsers[2].id, authorName: demoUsers[2].nickname, authorAvatar: demoUsers[2].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(2.5) },
    { id: 'c_10', targetType: 'wall', targetId: 'w_1', content: '有笔记影印版也可以一起出吗？', authorId: demoUsers[1].id, authorName: demoUsers[1].nickname, authorAvatar: demoUsers[1].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(2) },
    { id: 'c_10b', targetType: 'wall', targetId: 'w_1', content: '可以，笔记另算 5 块', authorId: demoUsers[0].id, authorName: demoUsers[0].nickname, authorAvatar: demoUsers[0].avatar, parentId: 'c_10', replyToId: 'c_10', replyToName: demoUsers[1].nickname, images: [], depth: 1, createdAt: nowMinus(1.8) },
    { id: 'c_11', targetType: 'wall', targetId: 'w_2', content: '我去汉口，占一个位置。', authorId: demoUsers[0].id, authorName: demoUsers[0].nickname, authorAvatar: demoUsers[0].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(6) },
    { id: 'c_12', targetType: 'wall', targetId: 'w_2', content: '能在街道口停一下吗？', authorId: demoUsers[1].id, authorName: demoUsers[1].nickname, authorAvatar: demoUsers[1].avatar, parentId: 'c_11', replyToId: 'c_11', replyToName: demoUsers[0].nickname, images: [], depth: 1, createdAt: nowMinus(5) },
    { id: 'c_13', targetType: 'wall', targetId: 'w_3', content: '我要一份草莓酸奶，算我一个。', authorId: demoUsers[2].id, authorName: demoUsers[2].nickname, authorAvatar: demoUsers[2].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(12) },
    { id: 'c_14', targetType: 'wall', targetId: 'w_3', content: '+1 芒果多多。', authorId: demoUsers[3].id, authorName: demoUsers[3].nickname, authorAvatar: demoUsers[3].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(11) },
    { id: 'c_15', targetType: 'wall', targetId: 'w_3', content: '满了吗？还差一个的话我来。', authorId: demoUsers[0].id, authorName: demoUsers[0].nickname, authorAvatar: demoUsers[0].avatar, parentId: 'c_14', replyToId: 'c_14', replyToName: demoUsers[3].nickname, images: [], depth: 1, createdAt: nowMinus(10) },
    { id: 'c_16', targetType: 'wall', targetId: 'w_4', content: '我有 Casio，周三中午西门给你。', authorId: demoUsers[2].id, authorName: demoUsers[2].nickname, authorAvatar: demoUsers[2].avatar, parentId: '', replyToId: '', replyToName: '', images: [], depth: 0, createdAt: nowMinus(20) },
    { id: 'c_17', targetType: 'wall', targetId: 'w_4', content: '考试加油，用完记得消毒一下哈哈。', authorId: demoUsers[1].id, authorName: demoUsers[1].nickname, authorAvatar: demoUsers[1].avatar, parentId: 'c_16', replyToId: 'c_16', replyToName: demoUsers[2].nickname, images: [], depth: 1, createdAt: nowMinus(18) }
  ]

  const schoolRequests = [
    {
      id: 'sr_demo1',
      userId: 'u_demo2',
      userNickname: '图书馆三楼靠窗',
      oldSchoolName: '武汉大学',
      oldSchoolCampus: '信息学部',
      newSchoolName: '华中科技大学',
      newSchoolCampus: '主校区',
      reason: '已办理转学，需要更新认证学校。',
      status: 'pending',
      createdAt: nowMinus(10),
      reviewedAt: 0,
      reviewNote: ''
    }
  ]

  wx.setStorageSync(KEYS.FORUM_POSTS, forumPosts)
  wx.setStorageSync(KEYS.WALL_POSTS, wallPosts)
  wx.setStorageSync(KEYS.COMMENTS, comments)
  wx.setStorageSync(KEYS.LIKES, {})
  wx.setStorageSync(KEYS.SCHOOL_REQUESTS, schoolRequests)
  wx.setStorageSync(KEYS.DISTRIBUTE_TARGETS, defaultDistributeTargets())
  wx.setStorageSync(KEYS.DISTRIBUTE_LOGS, [])
  wx.setStorageSync(KEYS.FILTER_KEYWORDS, defaultFilterKeywords())
  wx.setStorageSync(KEYS.DIGESTS, [])
  wx.setStorageSync(KEYS.DIGEST_QUEUE, buildDigestItems(wallPosts.map((post) => ({ type: 'wall', post }))))
  wx.setStorageSync(KEYS.WEEKLY_HOT, buildSeedWeeklyHot(wallPosts, forumPosts))
  wx.setStorageSync(KEYS.ACCOUNTS, demoUsers.map((item) => ({
    id: item.id,
    nickname: item.nickname,
    avatar: item.avatar,
    bio: '在这里遇见有趣的灵魂',
    schoolName: item.schoolName,
    schoolCampus: item.schoolCampus || '',
    schoolLocked: true,
    showSchoolTag: true,
    studentAuthStatus: 'none',
    status: 'active',
    muteUntil: 0,
    banReason: '',
    bannedAt: 0,
    riskScore: item.id === 'u_demo3' ? 40 : 0,
    violateCount: item.id === 'u_demo3' ? 2 : 0,
    createdAt: nowMinus(80)
  })))
  wx.setStorageSync(KEYS.SECURITY_LOGS, [
    {
      id: 'sl_demo1',
      level: 'warn',
      type: 'keyword_hit',
      userId: 'u_demo3',
      userNickname: '匿名小透明',
      detail: '发布内容命中敏感词',
      hits: ['代考'],
      createdAt: nowMinus(0.2)
    },
    {
      id: 'sl_demo2',
      level: 'warn',
      type: 'keyword_hit',
      userId: 'u_demo3',
      userNickname: '匿名小透明',
      detail: '发布内容命中敏感词',
      hits: ['代课'],
      createdAt: nowMinus(0.1)
    }
  ])
  wx.setStorageSync(KEYS.RATE_BUCKETS, {})
  wx.setStorageSync(KEYS.CONTACT_VIEWS, [])
  wx.setStorageSync(KEYS.CONTACT_FEEDBACKS, [])
  wx.setStorageSync(KEYS.CONVERSATIONS, [])
  wx.setStorageSync(KEYS.DM_MESSAGES, [])
  wx.setStorageSync(KEYS.INITIALIZED, true)
  flushDigest()
}

function defaultFilterKeywords() {
  return security.DEFAULT_KEYWORDS.slice()
}

function defaultDistributeTargets() {
  return [
    {
      id: 'g_customer',
      name: '群聊推送测试',
      type: 'external',
      enabled: true,
      webhook: '',
      chatId: '',
      sender: '',
      scopes: ['wall'],
      categories: [],
      boards: ['*'],
      desc: '群主企微 + 同学微信。满 10 条后走企微自动群发，群主确认一次',
      receiveDigest: true
    }
  ]
}

function ensureInit() {
  if (!wx.getStorageSync(KEYS.INITIALIZED)) {
    seedData()
  } else if (!wx.getStorageSync(KEYS.SCHOOL_REQUESTS)) {
    wx.setStorageSync(KEYS.SCHOOL_REQUESTS, [])
  }
  ensureDistributeTargets()
  if (!wx.getStorageSync(KEYS.DIGEST_QUEUE)) wx.setStorageSync(KEYS.DIGEST_QUEUE, [])
  if (!wx.getStorageSync(KEYS.DIGESTS)) wx.setStorageSync(KEYS.DIGESTS, [])
  if (!wx.getStorageSync(KEYS.ACCOUNTS)) wx.setStorageSync(KEYS.ACCOUNTS, [])
  if (!wx.getStorageSync(KEYS.SECURITY_LOGS)) wx.setStorageSync(KEYS.SECURITY_LOGS, [])
  if (!wx.getStorageSync(KEYS.RATE_BUCKETS)) wx.setStorageSync(KEYS.RATE_BUCKETS, {})
  if (!wx.getStorageSync(KEYS.CONTACT_VIEWS)) wx.setStorageSync(KEYS.CONTACT_VIEWS, [])
  if (!wx.getStorageSync(KEYS.CONTACT_FEEDBACKS)) wx.setStorageSync(KEYS.CONTACT_FEEDBACKS, [])
  if (!wx.getStorageSync(KEYS.CONVERSATIONS)) wx.setStorageSync(KEYS.CONVERSATIONS, [])
  if (!wx.getStorageSync(KEYS.DM_MESSAGES)) wx.setStorageSync(KEYS.DM_MESSAGES, [])
  ensureLexicons()
  // 本地演示：缓存被清掉但初始化标记还在时，补回示例帖
  const forumPosts = wx.getStorageSync(KEYS.FORUM_POSTS)
  const wallPosts = wx.getStorageSync(KEYS.WALL_POSTS)
  if ((!forumPosts || !forumPosts.length) && (!wallPosts || !wallPosts.length)) {
    seedData()
  }
  ensureWeeklyHotBoard()
  ensureFilterKeywords()
  migrateWallContacts()
  migrateDemoAvatars()
  const user = getUser()
  wx.setStorageSync(KEYS.USER, user)
  syncAccount(user)
  ensureDemoDm(user)
}

function migrateDemoAvatars() {
  const map = {
    u_demo1: '/images/avatar-1.png',
    u_demo2: '/images/avatar-2.png',
    u_demo3: '/images/avatar-3.png',
    u_demo4: '/images/avatar-4.png'
  }
  const patchList = (list) => {
    let changed = false
    const next = list.map((item) => {
      const nextAvatar = map[item.authorId]
      if (!nextAvatar) {
        if (item.anonymous && defaultProfile.isLegacyAvatar(item.authorAvatar)) {
          changed = true
          return { ...item, authorAvatar: defaultProfile.stableAvatar(item.id) }
        }
        return item
      }
      if (item.authorAvatar === nextAvatar) return item
      if (item.authorAvatar && item.authorAvatar.indexOf('/images/avatar') !== 0) return item
      changed = true
      return { ...item, authorAvatar: item.anonymous ? defaultProfile.stableAvatar(item.id) : defaultProfile.stableAvatar(item.authorId) }
    })
    return { changed, next }
  }
  const forum = patchList(getForumPosts())
  if (forum.changed) saveForumPosts(forum.next)
  const wall = patchList(getWallPosts())
  if (wall.changed) saveWallPosts(wall.next)
  const comments = patchList(getComments())
  if (comments.changed) saveComments(comments.next)
}

function migrateWallContacts() {
  const demoContacts = {
    w_1: { contactType: 'wechat', contactValue: 'wanfeng_csapp' },
    w_2: { contactType: 'wechat', contactValue: 'hanou_ride' },
    w_3: { contactType: 'wechat', contactValue: 'lib_window3' },
    w_4: { contactType: 'wechat', contactValue: 'casio_borrow' },
    w_5: { contactType: 'wechat', contactValue: 'wanfeng_csapp' },
    w_6: { contactType: 'wechat', contactValue: 'ipad_case35' },
    w_7: { contactType: 'wechat', contactValue: 'night_ride07' },
    w_8: { contactType: 'wechat', contactValue: 'mixue_pin8' },
    w_9: { contactType: 'wechat', contactValue: 'print_help09' },
    w_10: { contactType: 'wechat', contactValue: 'meiyuan_coupon' }
  }
  const list = getWallPosts()
  let changed = false
  const next = list.map((item) => {
    if (item.contactType === 'phone' || /^1[3-9]\d{9}$/.test(String(item.contactValue || ''))) {
      changed = true
      const demo = demoContacts[item.id]
      if (demo) return { ...item, ...demo }
      return { ...item, contactType: 'wechat', contactValue: '' }
    }
    if (item.contactType && item.contactValue) {
      if (item.contactType !== 'wechat') {
        changed = true
        return { ...item, contactType: 'wechat' }
      }
      return item
    }
    const demo = demoContacts[item.id]
    if (!demo) return item
    changed = true
    return { ...item, ...demo }
  })
  if (changed) saveWallPosts(next)
}

function createDefaultUser() {
  return {
    id: uid('u_'),
    nickname: defaultProfile.randomNickname(),
    avatar: defaultProfile.randomAvatar(),
    bio: '在这里遇见有趣的灵魂',
    createdAt: Date.now(),
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
    violateCount: 0,
    lastSeenLikesAt: 0,
    lastSeenCommentsAt: 0
  }
}

function normalizeUser(user) {
  const base = createDefaultUser()
  const next = { ...base, ...user, id: user.id || base.id }
  if (next.schoolChangeRequest && next.schoolChangeRequest.status === 'pending') {
    const latest = (getSchoolRequests() || []).find((item) => item.id === next.schoolChangeRequest.id)
    if (latest) next.schoolChangeRequest = latest
  }
  if (next.status === 'muted' && next.muteUntil && next.muteUntil <= Date.now()) {
    next.status = 'active'
    next.muteUntil = 0
    if (!next.bannedAt) next.banReason = ''
  }
  return next
}

function getUser() {
  let user = wx.getStorageSync(KEYS.USER)
  if (!user) {
    user = createDefaultUser()
    wx.setStorageSync(KEYS.USER, user)
    syncAccount(user)
    return user
  }
  const next = normalizeUser(user)
  const profilePatch = defaultProfile.defaultProfilePatch(next)
  if (profilePatch) Object.assign(next, profilePatch)
  if ((user.status === 'muted' && next.status === 'active') || profilePatch) {
    wx.setStorageSync(KEYS.USER, next)
    syncAccount(next)
  }
  return next
}

function updateUser(patch) {
  const blocked = [
    'id',
    'schoolName',
    'schoolCampus',
    'schoolLocked',
    'schoolSubmittedAt',
    'schoolChangeRequest',
    'studentAuthStatus',
    'studentAuthImages',
    'studentAuthNote',
    'studentAuthSubmittedAt',
    'studentAuthReviewedAt',
    'studentAuthReviewNote',
    'status',
    'muteUntil',
    'banReason',
    'bannedAt',
    'riskScore',
    'violateCount',
    'lastSeenLikesAt',
    'lastSeenCommentsAt'
  ]
  const safe = { ...patch }
  blocked.forEach((key) => {
    delete safe[key]
  })
  if (safe.nickname) {
    const review = runContentReview({ nickname: safe.nickname, contentType: 'nickname' })
    if (!review.passed) return { ok: false, message: review.message || '昵称未通过审核，请修改', user: getUser() }
  }
  if (safe.bio) {
    const review = runContentReview({ content: safe.bio, contentType: 'nickname' })
    if (!review.passed) return { ok: false, message: review.message || '签名未通过审核，请修改', user: getUser() }
  }
  if (Object.prototype.hasOwnProperty.call(safe, 'showSchoolTag')) {
    return setShowSchoolTag(!!safe.showSchoolTag)
  }
  const prev = getUser()
  const syncAvatar = Object.prototype.hasOwnProperty.call(safe, 'avatar')
  const syncNickname = Object.prototype.hasOwnProperty.call(safe, 'nickname')
  const user = persistCurrentUser({ ...prev, ...safe })
  if (syncAvatar || syncNickname) {
    syncAuthorProfileOnContent(user, {
      syncAvatar,
      syncNickname,
      oldNickname: prev.nickname || ''
    })
  }
  return { ok: true, user }
}

function persistCurrentUser(user) {
  const next = normalizeUser(user)
  wx.setStorageSync(KEYS.USER, next)
  syncAccount(next)
  return next
}

function formatSchool(user) {
  return [user.schoolName, user.schoolCampus].filter(Boolean).join(' · ')
}

function authorSchoolForUser(user, anonymous) {
  if (anonymous) return ''
  if (!user || !user.schoolLocked || !user.showSchoolTag) return ''
  return formatSchool(user)
}

function syncAuthorSchoolOnPosts(user) {
  const school = authorSchoolForUser(user, false)
  saveForumPosts(getForumPosts().map((item) => (
    item.authorId === user.id && !item.anonymous
      ? { ...item, authorSchool: school }
      : item
  )))
  saveWallPosts(getWallPosts().map((item) => (
    item.authorId === user.id && !item.anonymous
      ? { ...item, authorSchool: school }
      : item
  )))
}

/** 头像/昵称写在帖子与评论上，资料变更后回刷历史内容 */
function syncAuthorProfileOnContent(user, { syncAvatar = false, syncNickname = false, oldNickname = '' } = {}) {
  if (!user || !user.id) return
  if (!syncAvatar && !syncNickname) return

  const avatar = defaultProfile.resolveAvatar(user.avatar, user.id)
  const nickname = user.nickname || '黎安话事'
  const patchPost = (item) => {
    if (item.authorId !== user.id || item.anonymous) return item
    const next = { ...item }
    if (syncAvatar) next.authorAvatar = avatar
    if (syncNickname) next.authorName = nickname
    return next
  }

  saveForumPosts(getForumPosts().map(patchPost))
  saveWallPosts(getWallPosts().map(patchPost))

  const comments = getComments()
  const myCommentIds = new Set(
    comments.filter((item) => item.authorId === user.id).map((item) => item.id || item._id)
  )
  saveComments(comments.map((item) => {
    if (item.authorId === user.id) {
      const next = { ...item }
      if (syncAvatar) next.authorAvatar = avatar
      if (syncNickname) next.authorName = nickname
      return next
    }
    if (
      syncNickname
      && oldNickname
      && item.replyToName === oldNickname
      && item.replyToId
      && myCommentIds.has(item.replyToId)
    ) {
      return { ...item, replyToName: nickname }
    }
    return item
  }))
}

function setShowSchoolTag(enabled) {
  const user = getUser()
  if (enabled && !user.schoolLocked) {
    return { ok: false, message: '请先完成学校认证', user }
  }
  const next = persistCurrentUser({ ...user, showSchoolTag: !!enabled })
  syncAuthorSchoolOnPosts(next)
  return { ok: true, user: next }
}

function studentAuthStatusText(status) {
  if (status === 'approved') return '已通过学生认证'
  if (status === 'pending') return '学生认证审核中'
  if (status === 'rejected') return '学生认证未通过'
  return '未提交学生认证'
}

function submitStudentAuth({ images, note } = {}) {
  const user = getUser()
  if (!user.schoolLocked) return { ok: false, message: '请先完成学校认证' }
  if (user.studentAuthStatus === 'pending') return { ok: false, message: '已有审核中的申请' }
  if (user.studentAuthStatus === 'approved') return { ok: false, message: '已通过学生认证' }
  const photos = (images || []).filter(Boolean).slice(0, 3)
  const why = String(note || '').trim()
  const request = {
    id: uid('sa_'),
    type: 'student_auth',
    userId: user.id,
    userNickname: user.nickname,
    schoolName: user.schoolName,
    schoolCampus: user.schoolCampus || '',
    images: photos,
    note: why,
    status: 'pending',
    createdAt: Date.now(),
    reviewedAt: 0,
    reviewNote: ''
  }
  const next = persistCurrentUser({
    ...user,
    studentAuthStatus: 'pending',
    studentAuthImages: photos,
    studentAuthNote: why,
    studentAuthSubmittedAt: Date.now(),
    studentAuthReviewedAt: 0,
    studentAuthReviewNote: ''
  })
  saveSchoolRequests([request, ...getSchoolRequests().filter((item) => !(item.type === 'student_auth' && item.userId === user.id && item.status === 'pending'))])
  pushSecurityLog({
    level: 'info',
    type: 'student_auth_submit',
    userId: next.id,
    userNickname: next.nickname,
    detail: `提交学生认证材料：${formatSchool(next)}`
  })
  return { ok: true, user: next, request }
}

function listStudentAuthRequests(status = 'pending') {
  const list = getSchoolRequests()
    .filter((item) => item.type === 'student_auth')
    .sort((a, b) => b.createdAt - a.createdAt)
  if (!status || status === '全部') return list
  return list.filter((item) => item.status === status)
}

function reviewStudentAuth(requestId, { approved, note } = {}) {
  const list = getSchoolRequests()
  const req = list.find((item) => item.id === requestId && item.type === 'student_auth')
  if (!req || req.status !== 'pending') return { ok: false, message: '申请不存在或已处理' }
  const updated = {
    ...req,
    status: approved ? 'approved' : 'rejected',
    reviewedAt: Date.now(),
    reviewNote: note || (approved ? '学生身份核验通过' : '材料不清或不符，请重新提交')
  }
  saveSchoolRequests(list.map((item) => (item.id === requestId ? updated : item)))
  const patch = {
    studentAuthStatus: updated.status,
    studentAuthReviewedAt: updated.reviewedAt,
    studentAuthReviewNote: updated.reviewNote
  }
  applyUserPatch(req.userId, patch)
  const current = getUser()
  if (current.id === req.userId) {
    persistCurrentUser({ ...current, ...patch })
  }
  return { ok: true, request: updated }
}

function getSpeakGate(user = getUser()) {
  const current = normalizeUser(user)
  if (!current || !current.id || current.id === 'guest_readonly') {
    return {
      ok: false,
      code: 'NEED_LOGIN',
      title: '请先登录',
      message: '浏览开放。发帖、评论和私信请先登录。'
    }
  }
  if (current.status === 'banned') {
    return {
      ok: false,
      code: 'BANNED',
      title: '账号已封禁',
      message: current.banReason || '该账号因违规已被封禁，无法发言、评论或查看联系方式。'
    }
  }
  if (current.postWhitelist || current.appAdmin) {
    return { ok: true, code: 'OK', title: '', message: '' }
  }
  if (current.status === 'muted' && current.muteUntil > Date.now()) {
    return {
      ok: false,
      code: 'MUTED',
      title: '账号禁言中',
      message: `${current.banReason || '账号因异常行为被临时禁言。'}禁言至 ${formatDateTime(current.muteUntil)}。`
    }
  }
  if (!(current.schoolName && current.schoolLocked)) {
    return {
      ok: false,
      code: 'NEED_AUTH',
      title: '需要先认证学校',
      message: '发帖和评论前，请先填写所在学校完成基础认证，提交后立即生效，无需等待审核。'
    }
  }
  return { ok: true, code: 'OK', title: '', message: '' }
}

function canSpeak(user = getUser()) {
  return getSpeakGate(user).ok
}

function validateSchoolName(name) {
  const text = String(name || '').trim()
  if (!text) return { ok: false, message: '请填写学校名称' }
  if (text.length < 2) return { ok: false, message: '学校名称过短，请填写全称' }
  if (text.length > 40) return { ok: false, message: '学校名称过长' }
  return { ok: true, name: text }
}

function getSchoolRequests() {
  return wx.getStorageSync(KEYS.SCHOOL_REQUESTS) || []
}

function saveSchoolRequests(list) {
  wx.setStorageSync(KEYS.SCHOOL_REQUESTS, list)
}

// 本地演示：没有真实手机号接口，只模拟绑定成功，号码用占位值
function bindPhone(code) {
  if (!code) return { ok: false, message: '没有拿到手机号授权，请重试' }
  const user = getUser()
  applyUserPatch(user.id, { phone: '13800000000', phoneBoundAt: Date.now() })
  const next = { ...getUser(), phoneBound: true, phoneMasked: '138****0000' }
  return { ok: true, user: next }
}

function submitSchoolInfo({ schoolName, schoolCampus }) {
  const user = getUser()
  if (user.status === 'banned') {
    return { ok: false, code: 'BANNED', message: user.banReason || '账号已封禁' }
  }
  if (user.schoolLocked) {
    return { ok: false, message: '学校认证后不可修改' }
  }
  const checked = validateSchoolName(schoolName)
  if (!checked.ok) return checked
  const name = checked.name
  const limit = consumeRateLimit('schoolAuth')
  if (!limit.ok) return limit
  const next = persistCurrentUser({
    ...user,
    schoolName: name,
    schoolCampus: (schoolCampus || '').trim(),
    schoolLocked: true,
    schoolSubmittedAt: Date.now()
  })
  pushSecurityLog({
    level: 'info',
    type: 'school_auth',
    userId: next.id,
    userNickname: next.nickname,
    detail: `完成学校认证：${formatSchool(next)}`
  })
  return { ok: true, user: next }
}

// 学校认证后不可改校：保留桩，避免旧缓存 / 管理端残留引用炸掉
function requestSchoolChange() {
  return { ok: false, message: '学校认证后不可修改' }
}

function listSchoolRequests(status = 'pending') {
  const list = getSchoolRequests()
    .filter((item) => item.type !== 'student_auth')
    .sort((a, b) => b.createdAt - a.createdAt)
  if (!status || status === '全部') return list
  return list.filter((item) => item.status === status)
}

function reviewSchoolChange(requestId, { approved, note } = {}) {
  const list = getSchoolRequests()
  const req = list.find((item) => item.id === requestId)
  if (!req || req.status !== 'pending') {
    return { ok: false, message: '申请不存在或已处理' }
  }
  const updated = {
    ...req,
    status: approved ? 'approved' : 'rejected',
    reviewedAt: Date.now(),
    reviewNote: note || (approved ? '审核通过' : '审核未通过')
  }
  saveSchoolRequests(list.map((item) => (item.id === requestId ? updated : item)))

  const user = getUser()
  if (user.id === req.userId) {
    const next = { ...user, schoolChangeRequest: updated }
    if (approved) {
      next.schoolName = req.newSchoolName
      next.schoolCampus = req.newSchoolCampus
    }
    persistCurrentUser(next)
  }
  return { ok: true, request: updated }
}

function withReview(item) {
  return { ...item, reviewStatus: item.reviewStatus || 'approved' }
}

function getForumPosts() {
  return (wx.getStorageSync(KEYS.FORUM_POSTS) || []).map(withReview)
}

function getWallPosts() {
  return (wx.getStorageSync(KEYS.WALL_POSTS) || []).map(withReview)
}

function saveForumPosts(list) {
  wx.setStorageSync(KEYS.FORUM_POSTS, list)
}

function saveWallPosts(list) {
  wx.setStorageSync(KEYS.WALL_POSTS, list)
}

function getComments() {
  return wx.getStorageSync(KEYS.COMMENTS) || []
}

function saveComments(list) {
  wx.setStorageSync(KEYS.COMMENTS, list)
}

function getLikes() {
  return wx.getStorageSync(KEYS.LIKES) || {}
}

function saveLikes(map) {
  wx.setStorageSync(KEYS.LIKES, map)
}

function getLikeMeta() {
  return wx.getStorageSync(KEYS.LIKE_META) || {}
}

function saveLikeMeta(map) {
  wx.setStorageSync(KEYS.LIKE_META, map || {})
}

function sortByTime(list) {
  return [...list].sort((a, b) => b.createdAt - a.createdAt)
}

function postHeatScore(post, now = Date.now()) {
  const ageHours = Math.max(0.5, (now - (post.createdAt || now)) / 3600000)
  const heat = (post.likeCount || 0) * 3 + (post.commentCount || 0) * 4 + (post.viewCount || 0) * 0.05
  const freshness = 100 / (1 + ageHours / 24)
  return heat + freshness
}

function sortByTimeAndHeat(list) {
  const now = Date.now()
  return [...list].sort((a, b) => {
    const diff = postHeatScore(b, now) - postHeatScore(a, now)
    if (diff !== 0) return diff
    return (b.createdAt || 0) - (a.createdAt || 0)
  })
}

function listForum({ category = '全部', keyword = '', sort = 'new', official = false, includePending = false } = {}) {
  let list = getForumPosts()
  if (!includePending) {
    list = list.filter((item) => item.reviewStatus === 'approved')
  }
  if (category && category !== '全部') {
    list = list.filter((item) => item.category === category)
  }
  if (official) {
    list = list.filter((item) => homeFeed.isOfficialPost(item))
  }
  if (keyword) {
    const q = keyword.trim().toLowerCase()
    list = list.filter((item) => `${item.title} ${item.content}`.toLowerCase().includes(q))
  }
  list = sort === 'new' ? sortByTime(list) : sortByTimeAndHeat(list)
  return decorateList(list, 'forum')
}

function listWall({ tag = '全部', keyword = '', sort = 'new', dealStatus = '全部', official = false, includePending = false } = {}) {
  let list = getWallPosts()
  if (!includePending) {
    list = list.filter((item) => item.reviewStatus === 'approved')
  }
  if (tag && tag !== '全部') {
    list = list.filter((item) => item.tag === tag)
  }
  if (official) {
    list = list.filter((item) => homeFeed.isOfficialPost(item))
  }
  if (dealStatus && dealStatus !== '全部') {
    list = list.filter((item) => normalizeWallDealStatus(item.dealStatus) === dealStatus)
  }
  if (keyword) {
    const q = keyword.trim().toLowerCase()
    list = list.filter((item) => (
      `${item.title || ''} ${item.content || ''} ${item.price || ''} ${item.routeFrom || ''} ${item.routeTo || ''} ${item.departTime || ''} ${item.extra || ''} ${item.tag || ''}`
        .toLowerCase()
        .includes(q)
    ))
  }
  list = sort === 'new' ? sortByTime(list) : sortByTimeAndHeat(list)
  return decorateList(list, 'wall')
}

function listHome({ topic = '全部', keyword = '', sort = 'new', before = 0 } = {}) {
  const topicName = homeFeed.normalizeTopic(topic)
  const q = String(keyword || '').trim()
  const cursor = Number(before) || 0
  const take = (list, type) => (list || [])
    .filter((item) => homeFeed.isPublicPost(item))
    .filter((item) => !cursor || Number(item.createdAt) < cursor)
    .filter((item) => homeFeed.topicMatches(item, type, topicName))
    .filter((item) => !q || homeFeed.textHit(item, type, q))
    .map((item) => {
      const decorated = decorateList([item], type)[0]
      return { ...item, ...decorated, contentType: type }
    })
  const cards = homeFeed.sortHomePosts(
    take(getForumPosts(), 'forum').concat(take(getWallPosts(), 'wall')),
    sort === 'hot'
  ).map((item) => homeFeed.toHomeCard(item, item.contentType))
  const page = cards.slice(0, 24)
  const nextBefore = page.reduce((min, item) => {
    const time = Number(item && item.createdAt) || 0
    if (!time) return min
    return min ? Math.min(min, time) : time
  }, 0)
  return {
    posts: page,
    hasMore: cards.length > page.length,
    nextBefore
  }
}

function wallHeadline(item) {
  if (item.title) return item.title
  if (item.tag === '出行拼车' && (item.routeFrom || item.routeTo)) {
    return `${item.routeFrom || '出发地'} → ${item.routeTo || '目的地'}`
  }
  return item.tag || sectionLabel('wall')
}

function wallSummary(item) {
  if (item.tag === '二手闲置流转') return item.price || ''
  if (item.tag === '出行拼车') {
    return [item.departTime, item.extra].filter(Boolean).join(' · ')
  }
  if (item.tag === '拼单互助' || item.tag === '求物求助' || item.tag === '失物招领') return item.extra || ''
  return ''
}

function decorateList(list, type) {
  const user = getUser()
  const liked = (getLikes()[user.id] || {})[type] || []
  return list.map((item) => {
    const next = {
      ...item,
      liked: liked.includes(item.id),
      isOwner: item.authorId === user.id,
      official: !!(item.authorOfficial || item.official)
    }
    if (type === 'wall') {
      next.dealStatus = normalizeWallDealStatus(item.dealStatus)
      next.dealStatusLabel = wallDealStatusLabel(next.dealStatus)
      next.headline = wallHeadline(item)
      next.summary = wallSummary(item)
    }
    next.hasContact = !!(item.contactType && item.contactValue && item.contactType !== 'phone')
      && moderation.isPublicStatus(item.reviewStatus || 'approved')
    next.contactType = item.contactType || ''
    next.contactTypeLabel = contactTypeLabel(item.contactType)
    delete next.contactValue
    next.reviewStatusLabel = moderation.reviewStatusLabel(item.reviewStatus)
    if (!moderation.isPublicStatus(item.reviewStatus) && !next.isOwner) {
      next.content = item.reviewNote || '内容审核中'
      if (next.title) next.title = '内容审核中'
      if (next.headline) next.headline = '内容审核中'
    }
    return next
  })
}

function getPost(type, id) {
  const list = type === 'forum' ? getForumPosts() : getWallPosts()
  const post = list.find((item) => item.id === id)
  if (!post) return null
  const decorated = decorateList([post], type)[0]
  if (!moderation.isPublicStatus(decorated.reviewStatus) && !decorated.isOwner) return null
  return decorated
}

function bumpView(type, id) {
  const isForum = type === 'forum'
  const list = isForum ? getForumPosts() : getWallPosts()
  const next = list.map((item) => (
    item.id === id ? { ...item, viewCount: (item.viewCount || 0) + 1 } : item
  ))
  isForum ? saveForumPosts(next) : saveWallPosts(next)
}

function getFilterKeywords() {
  return ensureFilterKeywords()
}

function ensureFilterKeywords() {
  const current = wx.getStorageSync(KEYS.FILTER_KEYWORDS) || []
  const merged = Array.from(new Set(security.DEFAULT_KEYWORDS.concat(current).map((item) => String(item || '').trim()).filter(Boolean)))
  if (!current.length || merged.length !== current.length) {
    wx.setStorageSync(KEYS.FILTER_KEYWORDS, merged)
  }
  return wx.getStorageSync(KEYS.FILTER_KEYWORDS) || merged
}

function saveFilterKeywords(list) {
  const extra = (list || []).map((item) => String(item || '').trim()).filter(Boolean)
  const next = Array.from(new Set(security.LOCKED_KEYWORDS.concat(extra)))
  wx.setStorageSync(KEYS.FILTER_KEYWORDS, next)
  return next
}

function addFilterKeyword(word) {
  const key = String(word || '').trim()
  if (!key) return { ok: false, message: '请输入关键词' }
  const list = getFilterKeywords()
  if (list.includes(key)) return { ok: false, message: '这个词已经在列表里' }
  return { ok: true, list: saveFilterKeywords(list.concat(key)) }
}

function removeFilterKeyword(word) {
  if (security.isLockedKeyword(word)) {
    return { ok: false, message: '该词为一期必拦词，不能删除' }
  }
  return { ok: true, list: saveFilterKeywords(getFilterKeywords().filter((item) => item !== word)) }
}

function isLockedKeyword(word) {
  return security.isLockedKeyword(word)
}

function ensureLexicons() {
  const current = wx.getStorageSync(KEYS.LEXICONS)
  const seed = moderation.seedLexiconRows()
  if (!Array.isArray(current) || !current.length) {
    wx.setStorageSync(KEYS.LEXICONS, seed)
    wx.setStorageSync(KEYS.LEXICON_META, { version: 1, updatedAt: Date.now() })
    return seed
  }
  // 只补新增的内置词：内置词不可删除，因此不会复活管理员移除的词，也不会覆盖停用状态
  const existing = new Set(current.map((row) => row.id))
  const missing = seed.filter((row) => !existing.has(row.id))
  if (!missing.length) return current
  const next = current.concat(missing)
  wx.setStorageSync(KEYS.LEXICONS, next)
  bumpLexiconVersion()
  return next
}

function getLexiconRows() {
  return ensureLexicons()
}

function getLexiconMap() {
  return moderation.lexiconMapFromRows(getLexiconRows())
}

function getLexiconMeta() {
  ensureLexicons()
  return wx.getStorageSync(KEYS.LEXICON_META) || { version: 1, updatedAt: 0 }
}

function bumpLexiconVersion() {
  const meta = getLexiconMeta()
  const next = { version: (meta.version || 1) + 1, updatedAt: Date.now() }
  wx.setStorageSync(KEYS.LEXICON_META, next)
  return next
}

function listLexicons() {
  return {
    rows: getLexiconRows().slice().sort((a, b) => String(a.signal).localeCompare(b.signal) || String(a.word).localeCompare(b.word)),
    types: moderation.SIGNAL_TYPES,
    meta: getLexiconMeta()
  }
}

function addLexiconTerm(signal, word) {
  const typeOk = moderation.SIGNAL_TYPES.some((item) => item.id === signal)
  if (!typeOk) return { ok: false, message: '未知词库类型' }
  const text = String(word || '').trim()
  if (!text) return { ok: false, message: '请填写词语' }
  const rows = getLexiconRows()
  if (rows.some((item) => item.signal === signal && item.word === text)) {
    return { ok: false, message: '这个词已经在词库里' }
  }
  const now = Date.now()
  const row = {
    id: `${signal}::${text}`,
    signal,
    word: text,
    enabled: true,
    locked: false,
    version: (getLexiconMeta().version || 1) + 1,
    createdAt: now,
    updatedAt: now
  }
  wx.setStorageSync(KEYS.LEXICONS, [row, ...rows])
  return { ok: true, row, meta: bumpLexiconVersion(), ...listLexicons() }
}

function toggleLexiconTerm(id, enabled) {
  const rows = getLexiconRows()
  const index = rows.findIndex((item) => item.id === id || `${item.signal}::${item.word}` === id)
  if (index < 0) return { ok: false, message: '词条不存在' }
  rows[index] = { ...rows[index], enabled: enabled == null ? !rows[index].enabled : !!enabled, updatedAt: Date.now() }
  wx.setStorageSync(KEYS.LEXICONS, rows)
  return { ok: true, row: rows[index], meta: bumpLexiconVersion(), ...listLexicons() }
}

function removeLexiconTerm(id) {
  const rows = getLexiconRows()
  const target = rows.find((item) => item.id === id || `${item.signal}::${item.word}` === id)
  if (!target) return { ok: false, message: '词条不存在' }
  if (target.locked) return { ok: false, message: '首批示例词不能删除，可以停用' }
  wx.setStorageSync(KEYS.LEXICONS, rows.filter((item) => item !== target))
  return { ok: true, meta: bumpLexiconVersion(), ...listLexicons() }
}

function runContentReview(input) {
  return moderation.reviewText(input, { lexicons: getLexiconMap() })
}

function reviewPatch(review) {
  return {
    reviewStatus: review.reviewStatus,
    reviewNote: review.note || review.message || '',
    reviewOutcome: review.outcome,
    reviewRuleIds: review.ruleIds || [],
    reviewPriority: review.priority || 'normal',
    originalText: review.originalText || '',
    normalizedText: review.normalizedText || '',
    reviewSignals: review.signals || {},
    reviewTip: review.tip || '',
    matchedKeywords: Object.values(review.signals || {}).flat()
  }
}

function publishReviewResult(review, post, source, user) {
  if (moderation.countsAsViolation(review.outcome) || review.restrictAccount) {
    handleReviewViolation(user, review, source)
  }
  if (review.outcome === moderation.OUTCOMES.PASS) {
    return { ok: true, post, review }
  }
  if (review.outcome === moderation.OUTCOMES.EDIT_REQUIRED) {
    return { ok: false, code: 'EDIT_REQUIRED', post, review, message: review.message }
  }
  if (review.outcome === moderation.OUTCOMES.REJECT || review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK) {
    return { ok: false, code: review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 'EMERGENCY_BLOCK' : 'REJECTED', post, review, message: review.message }
  }
  return {
    ok: true,
    code: review.reviewStatus,
    post,
    review,
    message: review.message || '已提交，审核通过后才会公开'
  }
}

function getAccounts() {
  return wx.getStorageSync(KEYS.ACCOUNTS) || []
}

function saveAccounts(list) {
  wx.setStorageSync(KEYS.ACCOUNTS, list)
}

function syncAccount(user) {
  if (!user || !user.id) return
  const list = getAccounts()
  const snapshot = {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    schoolName: user.schoolName || '',
    schoolCampus: user.schoolCampus || '',
    schoolLocked: !!user.schoolLocked,
    showSchoolTag: !!user.showSchoolTag,
    studentAuthStatus: user.studentAuthStatus || 'none',
    status: user.status || 'active',
    muteUntil: user.muteUntil || 0,
    banReason: user.banReason || '',
    bannedAt: user.bannedAt || 0,
    riskScore: user.riskScore || 0,
    violateCount: user.violateCount || 0,
    createdAt: user.createdAt || Date.now()
  }
  const index = list.findIndex((item) => item.id === user.id)
  if (index >= 0) list[index] = { ...list[index], ...snapshot }
  else list.unshift(snapshot)
  saveAccounts(list)
}

function getSecurityLogs() {
  return wx.getStorageSync(KEYS.SECURITY_LOGS) || []
}

function saveSecurityLogs(list) {
  wx.setStorageSync(KEYS.SECURITY_LOGS, list)
}

function pushSecurityLog(entry) {
  const log = {
    id: uid('sl_'),
    createdAt: Date.now(),
    level: 'info',
    type: 'event',
    userId: '',
    userNickname: '',
    detail: '',
    hits: [],
    ...entry
  }
  saveSecurityLogs([log, ...getSecurityLogs()].slice(0, 200))
  return log
}

function getRateBuckets() {
  return wx.getStorageSync(KEYS.RATE_BUCKETS) || {}
}

function saveRateBuckets(map) {
  wx.setStorageSync(KEYS.RATE_BUCKETS, map)
}

function consumeRateLimit(action) {
  const buckets = getRateBuckets()
  const checked = security.checkRateLimit(buckets, action)
  if (!checked.ok) {
    pushSecurityLog({
      level: 'warn',
      type: 'rate_limit',
      userId: getUser().id,
      userNickname: getUser().nickname,
      detail: checked.message
    })
    return checked
  }
  saveRateBuckets(security.hitRateLimit(buckets, action))
  return { ok: true }
}

function getContactViews() {
  return wx.getStorageSync(KEYS.CONTACT_VIEWS) || []
}

function saveContactViews(list) {
  wx.setStorageSync(KEYS.CONTACT_VIEWS, list)
}

function getContactFeedbacks() {
  return wx.getStorageSync(KEYS.CONTACT_FEEDBACKS) || []
}

function saveContactFeedbacks(list) {
  wx.setStorageSync(KEYS.CONTACT_FEEDBACKS, list)
}

function contactFeedbackReasonLabel(reason) {
  const hit = CONTACT_FEEDBACK_REASONS.find((item) => item.id === reason)
  return (hit && hit.label) || '其他'
}

function applyUserPatch(userId, patch) {
  const current = getUser()
  if (current.id === userId) {
    return persistCurrentUser({ ...current, ...patch })
  }
  const list = getAccounts()
  const next = list.map((item) => (item.id === userId ? { ...item, ...patch } : item))
  saveAccounts(next)
  return next.find((item) => item.id === userId) || null
}

function handleKeywordViolation(user, hits, source) {
  return handleReviewViolation(user, {
    outcome: moderation.OUTCOMES.REJECT,
    message: `${source}命中敏感词：${(hits || []).join('、')}`,
    signals: { legacy: hits || [] },
    ruleIds: ['LEGACY']
  }, source)
}

function handleReviewViolation(user, review, source) {
  const hits = Object.values(review.signals || {}).flat()
  const violateCount = (user.violateCount || 0) + 1
  const riskScore = (user.riskScore || 0) + (review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 40 : 20)
  let status = user.status || 'active'
  let muteUntil = user.muteUntil || 0
  let banReason = user.banReason || ''
  let bannedAt = user.bannedAt || 0
  let level = review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 'critical' : 'warn'
  let type = review.notifyOwner ? 'emergency_block' : 'review_reject'
  let detail = `${source}：${review.message || review.note || '未通过审核'}（${(review.ruleIds || []).join('、') || '规则'}）`

  if (review.restrictAccount && status === 'active') {
    status = 'muted'
    muteUntil = Date.now() + security.DAY
    banReason = review.message || '冒充官方通知，限制发言 24 小时'
    type = 'auto_mute'
    detail = banReason
  } else if (violateCount >= 5 && status !== 'banned') {
    status = 'banned'
    banReason = '多次发布违规内容，系统自动封禁'
    bannedAt = Date.now()
    level = 'critical'
    type = 'auto_ban'
    detail = banReason
  } else if (violateCount >= 3 && status === 'active') {
    status = 'muted'
    muteUntil = Date.now() + security.DAY
    banReason = '短时间多次触发审核拒绝，禁言 24 小时'
    type = 'auto_mute'
    detail = banReason
  }

  const next = applyUserPatch(user.id, { violateCount, riskScore, status, muteUntil, banReason, bannedAt }) || {
    ...user,
    violateCount,
    riskScore,
    status,
    muteUntil,
    banReason,
    bannedAt
  }
  pushSecurityLog({
    level,
    type,
    userId: user.id,
    userNickname: user.nickname,
    detail,
    hits,
    ruleIds: review.ruleIds || [],
    notifyOwner: !!review.notifyOwner
  })
  return next
}

function guardSpeakAction(action) {
  const gate = getSpeakGate()
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
  if (action) {
    const limit = consumeRateLimit(action)
    if (!limit.ok) return limit
  }
  return { ok: true, user: getUser() }
}

function listAccounts() {
  syncAccount(getUser())
  return getAccounts()
    .slice()
    .sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0) || (b.createdAt || 0) - (a.createdAt || 0))
}

function setAccountStatus(userId, { status, reason, muteHours } = {}) {
  const account = getAccounts().find((item) => item.id === userId)
  if (!account) return { ok: false, message: '账号不存在' }
  const nextStatus = status === 'muted' || status === 'banned' ? status : 'active'
  const patch = {
    status: nextStatus,
    banReason: reason || (nextStatus === 'active' ? '' : account.banReason || ''),
    muteUntil: nextStatus === 'muted' ? Date.now() + (Number(muteHours) > 0 ? Number(muteHours) : 24) * security.HOUR : 0,
    bannedAt: nextStatus === 'banned' ? Date.now() : 0
  }
  applyUserPatch(userId, patch)
  pushSecurityLog({
    level: nextStatus === 'active' ? 'info' : 'critical',
    type: nextStatus === 'active' ? 'unban' : nextStatus === 'banned' ? 'manual_ban' : 'manual_mute',
    userId,
    userNickname: account.nickname,
    detail: patch.banReason || (nextStatus === 'active' ? '已解除限制' : '管理员处置')
  })
  return { ok: true, account: getAccounts().find((item) => item.id === userId) }
}

function listSecurityLogs() {
  return getSecurityLogs()
}

function listContactViews() {
  return getContactViews()
}

// 与云函数一致：同一次提交（submitId 相同）只落一条
function localPostId(prefix, submitId) {
  const text = String(submitId || '').trim()
  return /^[A-Za-z0-9_-]{8,64}$/.test(text) ? `${prefix}${text}` : ''
}

function createForumPost(rawPayload) {
  const payload = { ...(rawPayload || {}), anonymous: false }
  const gate = getSpeakGate()
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
  const user = getUser()
  const title = String(payload.title || '').trim()
  const content = String(payload.content || '').trim()
  const tag = homeFeed.cleanTag(payload.tag || payload.category) || homeFeed.DEFAULT_HOME_TAG
  const contact = validateWallContact(payload.contactType, payload.contactValue, tag)
  if (!contact.ok) return { ok: false, message: contact.message }
  const images = payload.images || []
  if (!title && !content && !images.length) return { ok: false, message: '请填写标题或正文' }
  const fingerprint = security.contentFingerprint(tag, title, content)
  const forumId = localPostId('f_', payload.submitId)
  const replayed = forumId && getForumPosts().find((item) => item.id === forumId && item.authorId === user.id)
  if (replayed) return { ok: true, post: replayed, replayed: true }
  if (!user.postWhitelist && security.hasDuplicateContent(getForumPosts(), user.id, fingerprint, (item) => (
    security.contentFingerprint(item.tag || item.category, item.title, item.content)
  ))) {
    return { ok: false, code: 'DUPLICATE', message: '请勿短时间重复发布相同内容' }
  }
  if (!user.postWhitelist) {
    const limit = consumeRateLimit('post')
    if (!limit.ok) return limit
  }
  const review = runContentReview({
    title,
    content,
    contentType: 'forum',
    category: tag,
    channel: tag
  })
  const post = {
    id: forumId || uid('f_'),
    tag,
    category: tag,
    title,
    content,
    images,
    authorId: user.id,
    authorName: payload.anonymous ? '匿名同学' : user.nickname,
    authorAvatar: payload.anonymous
      ? defaultProfile.stableAvatar('anonymous')
      : defaultProfile.resolveAvatar(user.avatar, user.id),
    authorSchool: authorSchoolForUser(user, payload.anonymous),
    anonymous: !!payload.anonymous,
    contactType: contact.contactType,
    contactValue: contact.contactValue,
    ...reviewPatch(review),
    createdAt: Date.now(),
    likeCount: 0,
    commentCount: 0,
    viewCount: 0
  }
  saveForumPosts([post, ...getForumPosts()])
  const result = publishReviewResult(review, post, '学习分享发帖', user)
  if (!review.passed) return result
  if (!user.postWhitelist && security.countRecentByAuthor(getForumPosts().concat(getWallPosts()), user.id, 30 * security.MINUTE) >= 8) {
    applyUserPatch(user.id, {
      status: 'muted',
      muteUntil: Date.now() + 2 * security.HOUR,
      banReason: '短时间大量发帖，临时禁言 2 小时',
      riskScore: (user.riskScore || 0) + 15
    })
    pushSecurityLog({
      level: 'warn',
      type: 'auto_mute',
      userId: user.id,
      userNickname: user.nickname,
      detail: '短时间大量发帖，临时禁言 2 小时'
    })
  }
  return { ok: true, post }
}

function createWallPost(rawPayload) {
  const payload = { ...(rawPayload || {}), anonymous: false }
  const gate = getSpeakGate()
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
  const user = getUser()
  const title = String(payload.title || payload.headline || '').trim()
  const content = String(payload.content || '').trim()
  if (!title) return { ok: false, message: '请填写标题' }
  const extra = (payload.extra || '').trim()
  const contact = validateWallContact(payload.contactType, payload.contactValue, payload.tag)
  if (!contact.ok) {
    return { ok: false, message: contact.message }
  }
  const fingerprint = security.contentFingerprint(payload.tag, title, content, extra, payload.routeFrom, payload.routeTo)
  const wallId = localPostId('w_', payload.submitId)
  const replayedWall = wallId && getWallPosts().find((item) => item.id === wallId && item.authorId === user.id)
  if (replayedWall) return { ok: true, post: replayedWall, replayed: true }
  if (!user.postWhitelist && security.hasDuplicateContent(getWallPosts(), user.id, fingerprint, (item) => (
    security.contentFingerprint(item.tag, item.title, item.content, item.extra, item.routeFrom, item.routeTo)
  ))) {
    return { ok: false, code: 'DUPLICATE', message: '请勿短时间重复发布相同内容' }
  }
  if (!user.postWhitelist) {
    const limit = consumeRateLimit('post')
    if (!limit.ok) return limit
  }
  const review = runContentReview({
    title,
    content,
    extra,
    routeFrom: payload.routeFrom,
    routeTo: payload.routeTo,
    departTime: payload.departTime,
    contentType: 'wall',
    tag: payload.tag,
    channel: payload.tag
  })
  const post = {
    id: wallId || uid('w_'),
    tag: payload.tag,
    title,
    price: (payload.price || '').trim(),
    routeFrom: (payload.routeFrom || '').trim(),
    routeTo: (payload.routeTo || '').trim(),
    departTime: (payload.departTime || '').trim(),
    extra,
    content,
    images: payload.images || [],
    contactType: contact.contactType,
    contactValue: contact.contactValue,
    authorId: user.id,
    authorName: payload.anonymous ? '匿名同学' : user.nickname,
    authorAvatar: payload.anonymous
      ? defaultProfile.stableAvatar('anonymous')
      : defaultProfile.resolveAvatar(user.avatar, user.id),
    authorSchool: authorSchoolForUser(user, payload.anonymous),
    anonymous: !!payload.anonymous,
    dealStatus: 'open',
    ...reviewPatch(review),
    createdAt: Date.now(),
    likeCount: 0,
    commentCount: 0,
    viewCount: 0
  }
  saveWallPosts([post, ...getWallPosts()])
  const result = publishReviewResult(review, post, '校园墙发帖', user)
  if (!review.passed) return result
  if (!user.postWhitelist && security.countRecentByAuthor(getForumPosts().concat(getWallPosts()), user.id, 30 * security.MINUTE) >= 8) {
    applyUserPatch(user.id, {
      status: 'muted',
      muteUntil: Date.now() + 2 * security.HOUR,
      banReason: '短时间大量发帖，临时禁言 2 小时',
      riskScore: (user.riskScore || 0) + 15
    })
    pushSecurityLog({
      level: 'warn',
      type: 'auto_mute',
      userId: user.id,
      userNickname: user.nickname,
      detail: '短时间大量发帖，临时禁言 2 小时'
    })
  }
  return { ok: true, post, distribution: enqueueApproved('wall', post) }
}

function updateWallDealStatus(id, dealStatus) {
  const user = getUser()
  const nextStatus = normalizeWallDealStatus(dealStatus)
  const list = getWallPosts()
  const post = list.find((item) => item.id === id)
  if (!post) return { ok: false, message: '这条信息已不存在' }
  if (post.authorId !== user.id) return { ok: false, message: '只有发布者可以改状态' }
  if (!moderation.isPublicStatus(post.reviewStatus)) return { ok: false, message: '未公开的内容不能改状态' }
  const next = list.map((item) => (
    item.id === id
      ? { ...item, dealStatus: nextStatus, dealStatusUpdatedAt: Date.now() }
      : item
  ))
  saveWallPosts(next)
  return { ok: true, post: getPost('wall', id) }
}

function revealWallContact(id) {
  const gate = getSpeakGate()
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.code === 'NEED_AUTH' ? '认证学校后才能查看联系方式' : gate.message }
  }
  const limit = consumeRateLimit('contactView')
  if (!limit.ok) return limit
  const user = getUser()
  const post = getWallPosts().find((item) => item.id === id)
    || getForumPosts().find((item) => item.id === id)
  if (!post) return { ok: false, message: '这条信息已不存在' }
  if (!moderation.isPublicStatus(post.reviewStatus) && post.authorId !== user.id) {
    return { ok: false, message: '这条信息已不存在' }
  }
  if (!post.contactType || !post.contactValue || post.contactType === 'phone') {
    return { ok: false, message: '发布者未留下微信号' }
  }
  const views = [{
    id: uid('cv_'),
    viewerId: user.id,
    viewerName: user.nickname,
    postId: post.id,
    authorId: post.authorId,
    createdAt: Date.now()
  }, ...getContactViews()].slice(0, 300)
  saveContactViews(views)
  const recentViews = views.filter((item) => item.viewerId === user.id && Date.now() - item.createdAt < security.DAY).length
  if (recentViews >= 15) {
    applyUserPatch(user.id, {
      status: 'muted',
      muteUntil: Date.now() + 6 * security.HOUR,
      banReason: '异常批量查看联系方式，临时禁言 6 小时',
      riskScore: (user.riskScore || 0) + 25
    })
    pushSecurityLog({
      level: 'critical',
      type: 'contact_crawl',
      userId: user.id,
      userNickname: user.nickname,
      detail: `24 小时内查看联系方式 ${recentViews} 次`
    })
  } else {
    pushSecurityLog({
      level: 'info',
      type: 'contact_view',
      userId: user.id,
      userNickname: user.nickname,
      detail: `查看了帖子 ${post.id} 的联系方式`
    })
  }
  return {
    ok: true,
    contactType: 'wechat',
    contactValue: post.contactValue,
    contactLabel: '微信号',
    canFeedback: post.authorId !== user.id
  }
}

function submitContactFeedback(id, payload = {}) {
  const gate = getSpeakGate()
  if (!gate.ok) {
    return { ok: false, code: gate.code, message: gate.code === 'NEED_AUTH' ? '认证学校后才能提交联系反馈' : gate.message }
  }
  const limit = consumeRateLimit('contactFeedback')
  if (!limit.ok) return limit
  const user = getUser()
  const post = getWallPosts().find((item) => item.id === id)
  if (!post) return { ok: false, message: '这条信息已不存在' }
  if (!moderation.isPublicStatus(post.reviewStatus) && post.authorId !== user.id) {
    return { ok: false, message: '这条信息已不存在' }
  }
  if (post.authorId === user.id) {
    return { ok: false, message: '不能反馈自己的联系方式' }
  }
  if (!needsWallContact(post.tag) || !post.contactType || !post.contactValue) {
    return { ok: false, message: '该帖未留下可反馈的联系方式' }
  }
  const viewed = getContactViews().some((item) => item.viewerId === user.id && item.postId === post.id)
  if (!viewed) {
    return { ok: false, message: '请先查看微信号后再反馈' }
  }
  const reasonMeta = CONTACT_FEEDBACK_REASONS.find((item) => item.id === payload.reason)
  if (!reasonMeta) {
    return { ok: false, message: '请选择反馈类型' }
  }
  const note = String(payload.note || '').trim().slice(0, 200)
  if (reasonMeta.id === 'other' && !note) {
    return { ok: false, message: '请补充说明' }
  }
  const list = getContactFeedbacks()
  const existing = list.find((item) => item.viewerId === user.id && item.postId === post.id)
  const row = {
    id: (existing && existing.id) || uid('cf_'),
    postId: post.id,
    authorId: post.authorId,
    viewerId: user.id,
    viewerName: user.nickname,
    reason: reasonMeta.id,
    reasonLabel: reasonMeta.label,
    note,
    tag: post.tag || '',
    postHeadline: wallHeadline(post),
    createdAt: (existing && existing.createdAt) || Date.now(),
    updatedAt: Date.now()
  }
  const next = existing
    ? list.map((item) => (item.id === existing.id ? row : item))
    : [row, ...list]
  saveContactFeedbacks(next.slice(0, 400))

  if (reasonMeta.id === 'scam_suspected') {
    const author = getAccounts().find((item) => item.id === post.authorId) || (getUser().id === post.authorId ? getUser() : null)
    applyUserPatch(post.authorId, {
      riskScore: ((author && author.riskScore) || 0) + 12
    })
    pushSecurityLog({
      level: 'warn',
      type: 'contact_feedback_scam',
      userId: user.id,
      userNickname: user.nickname,
      detail: `反馈帖子 ${post.id} 联系方式疑似诈骗`
    })
  } else {
    pushSecurityLog({
      level: 'info',
      type: 'contact_feedback',
      userId: user.id,
      userNickname: user.nickname,
      detail: `联系反馈 ${reasonMeta.label} · 帖子 ${post.id}`
    })
  }
  return { ok: true, feedback: row }
}

function getReports() {
  return wx.getStorageSync(KEYS.REPORTS) || []
}

function saveReports(list) {
  wx.setStorageSync(KEYS.REPORTS, list || [])
}

function reportReasonLabel(id) {
  const row = REPORT_REASONS.find((item) => item.id === id)
  return (row && row.label) || '其他违规'
}

function escalateReportedTarget(targetType, targetId, reportCount) {
  const note = `用户举报满 ${reportCount} 次，自动进入人工审核`
  if (targetType === 'comment') {
    saveComments(getComments().map((item) => (item.id !== targetId ? item : {
      ...item,
      reportCount,
      reviewStatus: 'manual_review',
      reviewOutcome: 'manual_review',
      reviewNote: note,
      reviewPriority: 'high',
      reportEscalatedAt: Date.now()
    })))
    return { escalated: true, kind: 'comment' }
  }
  if (targetType === 'forum' || targetType === 'wall') {
    const key = targetType === 'wall' ? KEYS.WALL_POSTS : KEYS.FORUM_POSTS
    const list = wx.getStorageSync(key) || []
    const next = list.map((item) => {
      if (item.id !== targetId) return item
      if (!moderation.isPublicStatus(item.reviewStatus) && item.reviewStatus !== 'approved') {
        return {
          ...item,
          reportCount,
          reviewNote: note,
          reviewPriority: 'high'
        }
      }
      return {
        ...item,
        reportCount,
        reviewStatus: 'manual_review',
        reviewOutcome: 'manual_review',
        reviewNote: note,
        reviewPriority: 'high',
        reportEscalatedAt: Date.now()
      }
    })
    wx.setStorageSync(key, next)
    return { escalated: true, kind: 'post' }
  }
  if (targetType === 'user') {
    applyUserPatch(targetId, {
      reportCount,
      reportStatus: 'manual_review',
      reportEscalatedAt: Date.now(),
      riskScore: ((getAccounts().find((item) => item.id === targetId) || {}).riskScore || 0) + 8
    })
    return { escalated: true, kind: 'user' }
  }
  return { escalated: false }
}

function submitReport({ targetType, targetId, reason, note } = {}) {
  const type = String(targetType || '').trim()
  const id = String(targetId || '').trim()
  if (!['forum', 'wall', 'comment', 'user'].includes(type) || !id) {
    return { ok: false, message: '举报对象无效' }
  }
  const reasonMeta = REPORT_REASONS.find((item) => item.id === reason) || REPORT_REASONS.find((item) => item.id === 'other')
  const user = getUser()
  const eligible = require('./report-rules').reportEligibility(user)
  if (!eligible.ok) return { ok: false, code: eligible.code, message: eligible.message }
  if (type === 'user' && user.id === id) return { ok: false, message: '不能举报自己' }
  if (type === 'forum' || type === 'wall') {
    const post = getPost(type, id)
    if (!post) return { ok: false, message: '内容不存在' }
    if (post.authorId === user.id) return { ok: false, message: '不能举报自己的帖子' }
  }
  if (type === 'comment') {
    const comment = getComments().find((item) => item.id === id)
    if (!comment) return { ok: false, message: '评论不存在' }
    if (comment.authorId === user.id) return { ok: false, message: '不能举报自己的评论' }
  }
  const list = getReports()
  if (list.some((item) => item.reporterId === user.id && item.targetType === type && item.targetId === id)) {
    return { ok: false, message: '你已经举报过了' }
  }
  const row = {
    id: uid('rp_'),
    targetType: type,
    targetId: id,
    reason: reasonMeta.id,
    reasonLabel: reasonMeta.label,
    note: String(note || '').trim().slice(0, 200),
    reporterId: user.id,
    reporterName: user.nickname || '黎安话事',
    status: 'pending',
    createdAt: Date.now(),
    resolvedAt: 0,
    resolveAction: '',
    resolveNote: ''
  }
  const next = [row, ...list].slice(0, 800)
  saveReports(next)
  const uniqueReporters = new Set(
    next
      .filter((item) => item.targetType === type && item.targetId === id && item.status !== 'dismissed')
      .map((item) => item.reporterId)
  )
  const reportCount = uniqueReporters.size
  let escalated = false
  if (reportCount >= REPORT_THRESHOLD) {
    const result = escalateReportedTarget(type, id, reportCount)
    escalated = !!result.escalated
    if (escalated) {
      pushSecurityLog({
        level: 'warn',
        type: 'report_escalate',
        userId: type === 'user' ? id : (getPost(type, id) || {}).authorId || '',
        userNickname: '',
        detail: `${type}:${id} 被举报 ${reportCount} 次，进入人工审核`
      })
    }
  } else {
    pushSecurityLog({
      level: 'info',
      type: 'report_submit',
      userId: user.id,
      userNickname: user.nickname,
      detail: `举报 ${type}:${id} · ${reasonMeta.label}`
    })
  }
  return { ok: true, report: row, reportCount, escalated, threshold: REPORT_THRESHOLD }
}

function listReports(status = 'pending') {
  const list = getReports().slice().sort((a, b) => b.createdAt - a.createdAt)
  if (!status || status === '全部') return list
  return list.filter((item) => item.status === status)
}

function resolveReport(reportId, { action, note, muteHours } = {}) {
  const list = getReports()
  const row = list.find((item) => item.id === reportId)
  if (!row) return { ok: false, message: '举报不存在' }
  const act = String(action || 'dismiss')
  let accountResult = null
  if (act === 'mute' || act === 'ban') {
    const targetUserId = row.targetType === 'user'
      ? row.targetId
      : ((getPost(row.targetType, row.targetId) || {}).authorId || '')
    if (targetUserId) {
      accountResult = setAccountStatus(targetUserId, {
        status: act === 'ban' ? 'banned' : 'muted',
        reason: note || (act === 'ban' ? '举报核实后封号' : '举报核实后禁言'),
        muteHours: muteHours || 24
      })
    }
  }
  if (act === 'delete' && (row.targetType === 'forum' || row.targetType === 'wall')) {
    reviewContent(row.targetType, row.targetId, {
      outcome: 'rejected',
      note: note || '因举报核实后删除/下架'
    })
  }
  if (act === 'hide' && (row.targetType === 'forum' || row.targetType === 'wall')) {
    reviewContent(row.targetType, row.targetId, {
      outcome: 'manual_review',
      note: note || '因举报转入人工审核'
    })
  }
  const updated = {
    ...row,
    status: 'resolved',
    resolvedAt: Date.now(),
    resolveAction: act,
    resolveNote: String(note || '').trim()
  }
  saveReports(list.map((item) => (item.id === reportId ? updated : item)))
  // 同目标未处理举报一并标记
  if (act !== 'dismiss') {
    const all = getReports().map((item) => {
      if (item.targetType === row.targetType && item.targetId === row.targetId && item.status === 'pending') {
        return {
          ...item,
          status: 'resolved',
          resolvedAt: Date.now(),
          resolveAction: act,
          resolveNote: String(note || '').trim() || '同类举报一并处理'
        }
      }
      return item
    })
    saveReports(all)
  }
  pushSecurityLog({
    level: act === 'dismiss' ? 'info' : 'warn',
    type: 'report_resolve',
    userId: row.targetType === 'user' ? row.targetId : '',
    userNickname: '',
    detail: `处理举报 ${row.id} → ${act}`
  })
  return { ok: true, report: updated, accountResult }
}

function listContactFeedbacks() {
  return getContactFeedbacks().sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))
}

function deletePost(type, id) {
  const user = getUser()
  const isForum = type === 'forum'
  const list = isForum ? getForumPosts() : getWallPosts()
  const target = list.find((item) => item.id === id)
  if (!target || target.authorId !== user.id) return false
  const next = list.filter((item) => item.id !== id)
  isForum ? saveForumPosts(next) : saveWallPosts(next)
  saveComments(getComments().filter((item) => !(item.targetType === type && item.targetId === id)))
  return true
}

function toggleLike(type, id) {
  const user = getUser()
  const likes = getLikes()
  const userLikes = likes[user.id] || { forum: [], wall: [] }
  const bucket = new Set(userLikes[type] || [])
  const liked = bucket.has(id)
  if (liked) bucket.delete(id)
  else bucket.add(id)
  userLikes[type] = Array.from(bucket)
  likes[user.id] = userLikes
  saveLikes(likes)
  const meta = getLikeMeta()
  const metaKey = `${user.id}_${type}_${id}`
  if (liked) delete meta[metaKey]
  else meta[metaKey] = Date.now()
  saveLikeMeta(meta)

  const isForum = type === 'forum'
  const list = isForum ? getForumPosts() : getWallPosts()
  const next = list.map((item) => {
    if (item.id !== id) return item
    const count = item.likeCount || 0
    return { ...item, likeCount: Math.max(0, count + (liked ? -1 : 1)) }
  })
  isForum ? saveForumPosts(next) : saveWallPosts(next)
  return !liked
}

function toggleCommentLike(commentId) {
  const user = getUser()
  if (!user || !user.id) return { ok: false, code: 'NEED_LOGIN', message: '请先登录' }
  const comment = getComments().find((item) => item.id === commentId)
  if (!comment) return { ok: false, message: '评论不存在' }
  const likes = getLikes()
  const userLikes = likes[user.id] || { forum: [], wall: [] }
  const bucket = new Set(userLikes.comment || [])
  const liked = bucket.has(commentId)
  if (liked) bucket.delete(commentId)
  else bucket.add(commentId)
  saveLikes({ ...likes, [user.id]: { ...userLikes, comment: Array.from(bucket) } })
  const likeCount = Math.max(0, (Number(comment.likeCount) || 0) + (liked ? -1 : 1))
  saveComments(getComments().map((item) => (item.id === commentId ? { ...item, likeCount } : item)))
  return { ok: true, liked: !liked, likeCount }
}

function listComments(type, id) {
  const user = getUser()
  const likedIds = new Set(((getLikes()[user.id] || {}).comment) || [])
  return getComments()
    .filter((item) => item.targetType === type && item.targetId === id)
    .filter((item) => moderation.isPublicStatus(item.reviewStatus || 'approved') || item.authorId === user.id)
    .map((item) => ({
      ...item,
      parentId: item.parentId || '',
      replyToId: item.replyToId || '',
      replyToName: item.replyToName || '',
      images: Array.isArray(item.images) ? item.images : [],
      depth: Number(item.depth) || 0,
      likeCount: Math.max(0, Number(item.likeCount) || 0),
      liked: likedIds.has(item.id),
      reviewStatusLabel: moderation.reviewStatusLabel(item.reviewStatus || 'approved'),
      mine: item.authorId === user.id,
      canDelete: item.authorId === user.id || item.postAuthorId === user.id,
      authorId: item.anonymous ? '' : item.authorId
    }))
    .sort((a, b) => a.createdAt - b.createdAt)
}

function addComment(type, id, content, extra = {}) {
  const gate = guardSpeakAction('comment')
  if (!gate.ok) return gate
  const user = gate.user
  const text = String(content || '').trim()
  const images = (Array.isArray(extra.images) ? extra.images : []).filter(Boolean).slice(0, 3)
  if (!text && !images.length) {
    return { ok: false, message: '写点文字或发张图吧' }
  }
  const review = runContentReview({
    content: text,
    contentType: 'comment',
    channel: extra.channel || extra.tag || extra.category || ''
  })
  if (text && review.outcome === moderation.OUTCOMES.EDIT_REQUIRED) {
    return { ok: false, code: 'EDIT_REQUIRED', review, message: review.message }
  }
  if (text && (review.outcome === moderation.OUTCOMES.REJECT || review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK)) {
    handleReviewViolation(user, review, '评论')
    return {
      ok: false,
      code: review.outcome === moderation.OUTCOMES.EMERGENCY_BLOCK ? 'EMERGENCY_BLOCK' : 'REJECTED',
      review,
      message: review.message
    }
  }

  let parentId = String(extra.parentId || '').trim()
  let replyToId = String(extra.replyToId || '').trim()
  let replyToName = String(extra.replyToName || '').trim()
  let replyToUserId = ''
  let depth = 0
  if (parentId) {
    const parent = getComments().find((item) => (
      item.id === parentId && item.targetType === type && item.targetId === id
    ))
    if (!parent) {
      return { ok: false, message: '回复的评论不存在' }
    }
    depth = (Number(parent.depth) || 0) + 1
    if (!replyToId) replyToId = parent.id
    if (!replyToName) replyToName = parent.authorName || ''
    replyToUserId = parent.authorId || ''
  } else {
    parentId = ''
    replyToId = ''
    replyToName = ''
  }

  const isForum = type === 'forum'
  const list = isForum ? getForumPosts() : getWallPosts()
  const post = list.find((item) => item.id === id)
  const comment = {
    id: uid('c_'),
    targetType: type,
    targetId: id,
    postAuthorId: post ? post.authorId : '',
    replyToUserId,
    content: text,
    images,
    parentId,
    replyToId,
    replyToName,
    depth,
    authorId: user.id,
    authorName: extra.anonymous ? '匿名同学' : user.nickname,
    authorAvatar: extra.anonymous ? defaultProfile.stableAvatar(`${id}:${user.id}`) : user.avatar,
    anonymous: !!extra.anonymous,
    likeCount: 0,
    ...reviewPatch(review),
    createdAt: Date.now()
  }
  saveComments([...getComments(), comment])

  if (moderation.isPublicStatus(comment.reviewStatus)) {
    const next = list.map((item) => (
      item.id === id ? { ...item, commentCount: (item.commentCount || 0) + 1 } : item
    ))
    isForum ? saveForumPosts(next) : saveWallPosts(next)
  }
  if (!moderation.isPublicStatus(comment.reviewStatus)) {
    return {
      ok: true,
      code: comment.reviewStatus,
      comment,
      message: review.message || '评论已提交，审核通过后可见'
    }
  }
  return { ok: true, comment }
}

function deleteComment(id) {
  const user = getUser()
  const comments = getComments()
  const comment = comments.find((item) => item.id === id)
  if (!comment) return { ok: false, message: '评论不存在' }
  if (comment.authorId !== user.id && comment.postAuthorId !== user.id) {
    return { ok: false, message: '只能删除自己的评论' }
  }
  const removeIds = new Set([id])
  comments.forEach((item) => {
    if (item.parentId === id) removeIds.add(item.id)
  })
  saveComments(comments.filter((item) => !removeIds.has(item.id)))
  const isForum = comment.targetType === 'forum'
  const list = isForum ? getForumPosts() : getWallPosts()
  const next = list.map((item) => {
    if (item.id !== comment.targetId) return item
    return { ...item, commentCount: Math.max(0, (item.commentCount || 0) - removeIds.size) }
  })
  isForum ? saveForumPosts(next) : saveWallPosts(next)
  return { ok: true, deleted: removeIds.size }
}

function myPosts(type) {
  const user = getUser()
  const list = type === 'forum' ? getForumPosts() : getWallPosts()
  return decorateList(list.filter((item) => item.authorId === user.id), type)
}

function myLiked(type) {
  const user = getUser()
  const ids = new Set(((getLikes()[user.id] || {})[type] || []))
  const list = type === 'forum' ? getForumPosts() : getWallPosts()
  return decorateList(list.filter((item) => ids.has(item.id)), type)
}

function resolveAccount(userId) {
  if (!userId) return null
  const me = getUser()
  if (me.id === userId) return me
  syncAccount(me)
  const hit = getAccounts().find((item) => item.id === userId)
  if (hit) return hit
  // 兜底：从公开帖文拼一份
  const forum = getForumPosts().find((item) => item.authorId === userId && !item.anonymous)
  const wall = getWallPosts().find((item) => item.authorId === userId && !item.anonymous)
  const sample = forum || wall
  if (!sample) return null
  return {
    id: userId,
    nickname: sample.authorName,
    avatar: sample.authorAvatar,
    bio: '在这里遇见有趣的灵魂',
    schoolName: '',
    schoolCampus: '',
    schoolLocked: !!sample.authorSchool,
    showSchoolTag: !!sample.authorSchool,
    studentAuthStatus: 'none',
    status: 'active'
  }
}

function statsForUser(userId) {
  const forum = getForumPosts().filter((item) => item.authorId === userId && !item.anonymous)
  const wall = getWallPosts().filter((item) => item.authorId === userId && !item.anonymous)
  return {
    postCount: forum.length + wall.length,
    receivedLikes: [...forum, ...wall].reduce((sum, item) => sum + (item.likeCount || 0), 0),
    receivedComments: [...forum, ...wall].reduce((sum, item) => sum + (item.commentCount || 0), 0)
  }
}

function getPublicProfile(userId) {
  const account = resolveAccount(userId)
  if (!account) return { ok: false, message: '用户不存在' }
  const me = getUser()
  const schoolText = account.schoolLocked && account.showSchoolTag
    ? formatSchool(account)
    : ''
  return {
    ok: true,
    isSelf: me.id === userId,
    profile: {
      id: account.id,
      nickname: account.nickname || '黎安话事',
      avatar: defaultProfile.resolveAvatar(account.avatar, account.id),
      bio: account.bio || '在这里遇见有趣的灵魂',
      schoolText,
      schoolLocked: !!account.schoolLocked,
      showSchoolTag: !!account.showSchoolTag,
      studentAuthApproved: account.studentAuthStatus === 'approved'
    },
    stats: statsForUser(userId)
  }
}

function listUserPosts(userId, type) {
  if (!userId) return []
  const isForum = type === 'forum'
  const list = isForum ? getForumPosts() : getWallPosts()
  return decorateList(
    list.filter((item) => item.authorId === userId && !item.anonymous),
    isForum ? 'forum' : 'wall'
  )
}

function myComments() {
  const user = getUser()
  const forumById = {}
  const wallById = {}
  getForumPosts().forEach((item) => { forumById[item.id] = item })
  getWallPosts().forEach((item) => { wallById[item.id] = item })
  return getComments()
    .filter((item) => item.authorId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((item) => {
      const post = item.targetType === 'wall' ? wallById[item.targetId] : forumById[item.targetId]
      return {
        ...item,
        postExists: !!post,
        postTitle: post
          ? (item.targetType === 'wall' ? wallHeadline(post) : post.title)
          : '原帖已删除',
        postBadge: sectionLabel(item.targetType === 'wall' ? 'wall' : 'forum')
      }
    })
}

function myReceivedComments() {
  const snapshotAt = Date.now()
  const user = getUser()
  const forumById = {}
  const wallById = {}
  getForumPosts().forEach((item) => { forumById[item.id] = item })
  getWallPosts().forEach((item) => { wallById[item.id] = item })
  const comments = getComments()
    .filter((item) => {
      if (item.authorId === user.id) return false
      const postAuthorId = item.postAuthorId
        || (item.targetType === 'wall'
          ? (wallById[item.targetId] && wallById[item.targetId].authorId)
          : (forumById[item.targetId] && forumById[item.targetId].authorId))
      return postAuthorId === user.id || item.replyToUserId === user.id
    })
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((item) => {
      const post = item.targetType === 'wall' ? wallById[item.targetId] : forumById[item.targetId]
      const canOpen = !!post && (homeFeed.isPublicPost(post) || post.authorId === user.id)
      const images = post && Array.isArray(post.images) ? post.images.filter(Boolean) : []
      return {
        ...item,
        postExists: canOpen,
        postCover: canOpen ? (images[0] || '') : '',
        postTitle: canOpen
          ? (item.targetType === 'wall' ? wallHeadline(post) : post.title)
          : '原帖已不可用',
        postBadge: sectionLabel(item.targetType === 'wall' ? 'wall' : 'forum')
      }
    })
  return { comments, snapshotAt }
}

function myReceivedLikes() {
  const snapshotAt = Date.now()
  const user = getUser()
  const forumById = {}
  const wallById = {}
  getForumPosts().forEach((item) => { forumById[item.id] = item })
  getWallPosts().forEach((item) => { wallById[item.id] = item })
  const myForum = new Set(Object.keys(forumById).filter((id) => forumById[id].authorId === user.id))
  const myWall = new Set(Object.keys(wallById).filter((id) => wallById[id].authorId === user.id))
  const likes = getLikes()
  const meta = getLikeMeta()
  const rows = []
  Object.keys(likes).forEach((likerId) => {
    if (likerId === user.id) return
    const bucket = likes[likerId] || {}
    ;['forum', 'wall'].forEach((type) => {
      const mine = type === 'wall' ? myWall : myForum
      ;(bucket[type] || []).forEach((postId) => {
        if (!mine.has(postId)) return
        const post = type === 'wall' ? wallById[postId] : forumById[postId]
        const canOpen = !!post && (homeFeed.isPublicPost(post) || post.authorId === user.id)
        const account = resolveAccount(likerId)
        const images = post && Array.isArray(post.images) ? post.images.filter(Boolean) : []
        rows.push({
          id: `${likerId}_${type}_${postId}`,
          userId: likerId,
          userName: (account && account.nickname) || '同学',
          userAvatar: defaultProfile.resolveAvatar(account && account.avatar, likerId),
          contentType: type,
          postId,
          createdAt: meta[`${likerId}_${type}_${postId}`] || 0,
          postExists: canOpen,
          postCover: canOpen ? (images[0] || '') : '',
          postTitle: canOpen
            ? (type === 'wall' ? wallHeadline(post) : post.title)
            : '原帖已不可用',
          postBadge: sectionLabel(type)
        })
      })
    })
  })
  return {
    likes: rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    snapshotAt
  }
}

function getInboxBadges() {
  const user = getUser()
  const lastSeenLikesAt = Number(user.lastSeenLikesAt) || 0
  const lastSeenCommentsAt = Number(user.lastSeenCommentsAt) || 0
  const myForum = new Set(getForumPosts().filter((item) => item.authorId === user.id).map((item) => item.id))
  const myWall = new Set(getWallPosts().filter((item) => item.authorId === user.id).map((item) => item.id))
  const likes = getLikes()
  const meta = getLikeMeta()
  let unreadLikes = 0
  Object.keys(likes).forEach((userId) => {
    if (userId === user.id) return
    const bucket = likes[userId] || {}
    ;(bucket.forum || []).forEach((id) => {
      if (!myForum.has(id)) return
      if ((meta[`${userId}_forum_${id}`] || 1) > lastSeenLikesAt) unreadLikes += 1
    })
    ;(bucket.wall || []).forEach((id) => {
      if (!myWall.has(id)) return
      if ((meta[`${userId}_wall_${id}`] || 1) > lastSeenLikesAt) unreadLikes += 1
    })
  })
  const unreadComments = getComments().filter((item) => (
    item.authorId !== user.id
    && (item.createdAt || 1) > lastSeenCommentsAt
    && (
      item.postAuthorId === user.id
      || item.replyToUserId === user.id
      || (item.targetType === 'wall' && myWall.has(item.targetId))
      || (item.targetType !== 'wall' && myForum.has(item.targetId))
    )
  )).length
  const unreadMessages = getConversations()
    .filter((item) => (item.memberIds || []).includes(user.id))
    .reduce((sum, item) => sum + (Number((item.unread || {})[user.id]) || 0), 0)
  return {
    ok: true,
    badges: { unreadLikes, unreadComments, unreadMessages }
  }
}

function markInboxSeen(payload = {}) {
  const user = getUser()
  const next = { ...user }
  const likes = payload && payload.likes === true
  const comments = payload && payload.comments === true
  if (!likes && !comments) return { ok: false, message: '未指定已读类别' }
  if (likes) {
    const at = Number(payload.likesAt) || 0
    if (!at) return { ok: false, message: '缺少已读位置' }
    next.lastSeenLikesAt = Math.max(Number(user.lastSeenLikesAt) || 0, at)
  }
  if (comments) {
    const at = Number(payload.commentsAt) || 0
    if (!at) return { ok: false, message: '缺少已读位置' }
    next.lastSeenCommentsAt = Math.max(Number(user.lastSeenCommentsAt) || 0, at)
  }
  persistCurrentUser(next)
  return { ok: true, user: next }
}

function getShareCode({ type = 'forum', id = '' } = {}) {
  const post = getPost(type === 'wall' ? 'wall' : 'forum', id)
  if (!post || !sharePoster.isPublicApproved(post)) {
    return { ok: false, code: 'NOT_PUBLIC', message: '内容暂不可生成分享图' }
  }
  return {
    ok: true,
    code: {
      page: sharePoster.detailPageFor(type),
      scene: sharePoster.sceneForPost(type, id),
      envVersion: 'develop',
      fileId: '',
      imageUrl: '',
      localDemo: true
    }
  }
}

function generateSharePoster({ postSource = 'forum', postId = '', requestId = '' } = {}) {
  const type = postSource === 'wall' ? 'wall' : 'forum'
  const post = getPost(type, postId)
  if (!post || !sharePoster.isPublicApproved(post)) {
    return { ok: false, code: 'NOT_PUBLIC', message: '内容暂不可生成分享图' }
  }
  const publicPost = sharePoster.shapePublicPost(post, type)
  delete publicPost.viewCount
  return {
    ok: true,
    status: 'ready',
    imageFileId: '',
    postSource: type,
    postId,
    postRevision: sharePoster.buildPostRevision(post, type),
    templateVersion: sharePoster.TEMPLATE_VERSION,
    requestId,
    width: sharePoster.POSTER_WIDTH,
    height: 0,
    publicPost,
    originalPostCode: {
      page: sharePoster.detailPageFor(type),
      scene: sharePoster.sceneForPost(type, postId),
      envVersion: 'develop',
      fileId: '',
      localDemo: true
    }
  }
}

function validateSharePoster({ postSource = 'forum', postId = '', postRevision = '' } = {}) {
  const type = postSource === 'wall' ? 'wall' : 'forum'
  const post = getPost(type, postId)
  if (!post || !sharePoster.isPublicApproved(post)) {
    return { ok: true, canSave: false, reason: '内容已下架或不可查看' }
  }
  const latest = sharePoster.buildPostRevision(post, type)
  if (postRevision && latest !== postRevision) {
    return { ok: true, canSave: false, reason: '帖子内容已更新，请重新生成' }
  }
  return { ok: true, canSave: true, postRevision: latest }
}

function getConversations() {
  return wx.getStorageSync(KEYS.CONVERSATIONS) || []
}

function saveConversations(list) {
  wx.setStorageSync(KEYS.CONVERSATIONS, list || [])
}

function getDmMessages() {
  return wx.getStorageSync(KEYS.DM_MESSAGES) || []
}

function saveDmMessages(list) {
  wx.setStorageSync(KEYS.DM_MESSAGES, list || [])
}

function pairKeyFor(a, b) {
  return [String(a), String(b)].sort().join('__')
}

function decorateConversation(conv, meId) {
  const peerId = (conv.memberIds || []).find((id) => id !== meId) || ''
  const peer = resolveAccount(peerId) || {}
  const unreadMap = conv.unread || {}
  return {
    ...conv,
    peerId,
    peerName: peer.nickname || '同学',
    peerAvatar: defaultProfile.resolveAvatar(peer.avatar, peer.id),
    unreadCount: Number(unreadMap[meId]) || 0
  }
}

function ensureDemoDm(user) {
  if (!user || !user.id) return
  const list = getConversations()
  if (!list.some((item) => (item.memberIds || []).includes(user.id))) {
    const peer = resolveAccount('u_demo2') || {
      id: 'u_demo2',
      nickname: '图书馆三楼靠窗',
      avatar: '/images/avatar-2.png'
    }
    const now = Date.now()
    const conversation = {
      id: uid('cv_'),
      pairKey: pairKeyFor(user.id, peer.id),
      memberIds: [user.id, peer.id],
      lastMessageAt: now - 60000,
      lastPreview: '你好，看到你的帖子了～',
      lastSenderId: peer.id,
      unread: { [user.id]: 1, [peer.id]: 0 },
      createdAt: now - 120000
    }
    const messages = [
      {
        id: uid('dm_'),
        conversationId: conversation.id,
        senderId: peer.id,
        content: '你好，看到你的帖子了～',
        createdAt: now - 60000
      }
    ]
    saveConversations([conversation, ...list])
    saveDmMessages([...messages, ...getDmMessages()])
  }

  // 演示「别人评论我」：给当前用户补一条墙贴 + 别人的评论（仅一次）
  const mineWall = getWallPosts().some((item) => item.authorId === user.id)
  if (mineWall) return
  const peer = resolveAccount('u_demo2') || {
    id: 'u_demo2',
    nickname: '图书馆三楼靠窗',
    avatar: '/images/avatar-2.png'
  }
  const postId = uid('w_')
  const post = {
    id: postId,
    tag: '求物求助',
    title: '求借一把雨伞，今天下午还',
    price: '',
    routeFrom: '',
    routeTo: '',
    departTime: '',
    extra: '今天下午',
    content: '临时下雨，谁方便借一下，西区面交。',
    images: [],
    contactType: 'wechat',
    contactValue: 'demo_rain',
    authorId: user.id,
    authorName: user.nickname,
    authorAvatar: user.avatar,
    authorSchool: formatSchool(user),
    anonymous: false,
    reviewStatus: 'approved',
    dealStatus: 'open',
    createdAt: Date.now() - 3600000,
    likeCount: 2,
    commentCount: 1,
    viewCount: 12
  }
  saveWallPosts([post, ...getWallPosts()])
  saveComments([{
    id: uid('c_'),
    targetType: 'wall',
    targetId: postId,
    postAuthorId: user.id,
    content: '我有一把，下午两点西门见？',
    images: [],
    parentId: '',
    replyToId: '',
    replyToName: '',
    depth: 0,
    authorId: peer.id,
    authorName: peer.nickname,
    authorAvatar: peer.avatar,
    createdAt: Date.now() - 1800000
  }, ...getComments()])
}

function listConversations() {
  const me = getUser()
  return getConversations()
    .filter((item) => (item.memberIds || []).includes(me.id))
    .sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
    .map((item) => decorateConversation(item, me.id))
}

function openOrCreateConversation(peerId) {
  const gate = getSpeakGate()
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
  const me = getUser()
  const peer = String(peerId || '').trim()
  if (!peer) return { ok: false, message: '用户不存在' }
  if (peer === me.id) return { ok: false, message: '不能给自己发私信' }
  if (!resolveAccount(peer)) return { ok: false, message: '用户不存在' }

  const key = pairKeyFor(me.id, peer)
  let conversation = getConversations().find((item) => item.pairKey === key)
  if (!conversation) {
    conversation = {
      id: uid('cv_'),
      pairKey: key,
      memberIds: [me.id, peer],
      lastMessageAt: 0,
      lastPreview: '',
      lastSenderId: '',
      unread: { [me.id]: 0, [peer]: 0 },
      createdAt: Date.now()
    }
    saveConversations([conversation, ...getConversations()])
  }
  return { ok: true, conversation: decorateConversation(conversation, me.id) }
}

function getConversation(conversationId) {
  const me = getUser()
  const conversation = getConversations().find((item) => item.id === conversationId)
  if (!conversation || !(conversation.memberIds || []).includes(me.id)) {
    return { ok: false, message: '会话不存在' }
  }
  return { ok: true, conversation: decorateConversation(conversation, me.id) }
}

function listMessages(conversationId) {
  const me = getUser()
  const conversation = getConversations().find((item) => item.id === conversationId)
  if (!conversation || !(conversation.memberIds || []).includes(me.id)) {
    return []
  }
  return getDmMessages()
    .filter((item) => item.conversationId === conversationId)
    .filter((item) => {
      const status = item.reviewStatus || 'approved'
      return item.senderId === me.id || moderation.isPublicStatus(status)
    })
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((item) => ({
      ...item,
      mine: item.senderId === me.id
    }))
}

function markConversationRead(conversationId, unreadAtOpen) {
  const me = getUser()
  const list = getConversations()
  const index = list.findIndex((item) => item.id === conversationId)
  if (index < 0) return { ok: false, message: '会话不存在' }
  const conversation = list[index]
  if (!(conversation.memberIds || []).includes(me.id)) {
    return { ok: false, message: '会话不存在' }
  }
  const opened = Number(unreadAtOpen)
  const current = Number((conversation.unread || {})[me.id]) || 0
  const keep = Number.isFinite(opened) && opened >= 0 ? Math.max(0, current - opened) : current
  if (!Number.isFinite(opened) || opened < 0) return { ok: false, message: '缺少已读位置' }
  const unread = { ...(conversation.unread || {}), [me.id]: keep }
  list[index] = { ...conversation, unread }
  saveConversations(list)
  return { ok: true, conversation: decorateConversation(list[index], me.id) }
}

function sendMessage(conversationId, content, images = []) {
  const gate = guardSpeakAction('dm')
  if (!gate.ok) return gate
  const me = gate.user
  const text = String(content || '').trim()
  const photos = (Array.isArray(images) ? images : []).filter(Boolean).slice(0, 3)
  if (!text && !photos.length) return { ok: false, message: '写点文字或发张图吧' }
  if (text.length > 2000) return { ok: false, message: '私信最多 2000 字' }
  const review = runContentReview({ content: text, contentType: 'dm' })
  if (review.outcome === moderation.OUTCOMES.EDIT_REQUIRED) {
    return { ok: false, code: 'EDIT_REQUIRED', review, message: review.message || '请修改后再发送' }
  }
  if (moderation.countsAsViolation(review.outcome) || review.restrictAccount) {
    handleReviewViolation(me, review, '私信')
    return { ok: false, code: review.outcome, review, message: review.message || '内容未通过审核，请修改后重试' }
  }

  const list = getConversations()
  const index = list.findIndex((item) => item.id === conversationId)
  if (index < 0) return { ok: false, message: '会话不存在' }
  const conversation = list[index]
  if (!(conversation.memberIds || []).includes(me.id)) {
    return { ok: false, message: '会话不存在' }
  }

  const now = Date.now()
  const held = !moderation.isPublicStatus(review.reviewStatus)
  const message = {
    id: uid('dm_'),
    conversationId,
    senderId: me.id,
    content: text,
    images: photos,
    reviewStatus: review.reviewStatus,
    reviewNote: review.note || review.message || '',
    reviewOutcome: review.outcome,
    createdAt: now
  }
  saveDmMessages([...getDmMessages(), message])

  if (!held) {
    const unread = { ...(conversation.unread || {}) }
    ;(conversation.memberIds || []).forEach((id) => {
      if (id === me.id) unread[id] = 0
      else unread[id] = (Number(unread[id]) || 0) + 1
    })
    list[index] = {
      ...conversation,
      lastMessageAt: now,
      lastPreview: text ? text.slice(0, 40) : '[图片]',
      lastSenderId: me.id,
      unread
    }
    saveConversations(list)
  }
  return {
    ok: true,
    held,
    notice: held ? (review.message || '审核通过后对方才能看到') : '',
    message: { ...message, mine: true },
    conversation: decorateConversation(list[index], me.id)
  }
}

function stats() {
  const user = getUser()
  const forum = getForumPosts()
  const wall = getWallPosts()
  const mineForum = forum.filter((item) => item.authorId === user.id)
  const mineWall = wall.filter((item) => item.authorId === user.id)
  const receivedLikes = [...mineForum, ...mineWall].reduce((sum, item) => sum + (item.likeCount || 0), 0)
  const receivedComments = [...mineForum, ...mineWall].reduce((sum, item) => sum + (item.commentCount || 0), 0)
  return {
    postCount: mineForum.length + mineWall.length,
    receivedLikes,
    receivedComments
  }
}

function adminOverview() {
  const forum = getForumPosts()
  const wall = getWallPosts()
  const school = getSchoolRequests()
  const progress = digestProgress()
  const groups = getDistributeTargets()
  const logs = getDistributeLogs()
  const rejected = [...forum, ...wall].filter((item) => item.reviewStatus === 'rejected' || item.reviewStatus === 'emergency_block')
  const pendingReview = [...forum, ...wall].filter((item) => ['pending', 'manual_review', 'edit_required'].includes(item.reviewStatus))
  const emergencyCount = [...forum, ...wall].filter((item) => item.reviewStatus === 'emergency_block').length
  const accounts = getAccounts()
  const securityLogs = getSecurityLogs()
  return {
    forumCount: forum.length,
    wallCount: wall.length,
    postCount: forum.length + wall.length,
    interceptCount: rejected.length,
    pendingReview: pendingReview.length,
    emergencyCount,
    pendingSchool: school.filter((item) => item.status === 'pending').length,
    digestCount: progress.count,
    digestSize: progress.size,
    digestRemain: progress.remain,
    designatedGroups: groups.filter((item) => item.receiveDigest && item.enabled).length,
    groupCount: groups.length,
    logCount: (logs || []).length,
    bannedCount: accounts.filter((item) => item.status === 'banned').length,
    mutedCount: accounts.filter((item) => item.status === 'muted' && item.muteUntil > Date.now()).length,
    riskLogCount: securityLogs.length,
    contactViewCount: getContactViews().length,
    contactFeedbackCount: getContactFeedbacks().length
  }
}

function listContentReviews(status = 'pending') {
  const forum = getForumPosts().map((item) => ({
    ...item,
    contentType: 'forum',
    headline: item.title,
    channel: item.category
  }))
  const wall = getWallPosts().map((item) => {
    const next = {
      ...item,
      contentType: 'wall',
      headline: wallHeadline(item),
      channel: item.tag,
      hasContact: !!(item.contactType && item.contactValue)
    }
    delete next.contactValue
    return next
  })
  let list = [...forum, ...wall].sort((a, b) => b.createdAt - a.createdAt)
  if (status && status !== '全部') {
    list = list.filter((item) => item.reviewStatus === status)
  }
  return list
}

function ensureDistributeTargets() {
  const defaults = defaultDistributeTargets()
  const current = wx.getStorageSync(KEYS.DISTRIBUTE_TARGETS) || []
  if (!current.length) {
    saveDistributeTargets(defaults)
    return defaults
  }
  const ids = new Set(current.map((item) => item.id))
  const merged = current.slice()
  defaults.forEach((item) => {
    if (!ids.has(item.id)) merged.push(item)
  })
  const next = merged.map((item) => {
    const fallback = defaults.find((one) => one.id === item.id)
    return fallback ? { ...fallback, ...item, desc: item.desc || fallback.desc } : item
  })
  saveDistributeTargets(next)
  return next
}

function getDistributeTargets() {
  return ensureDistributeTargets()
}

function saveDistributeTargets(list) {
  wx.setStorageSync(KEYS.DISTRIBUTE_TARGETS, list)
}

function toggleDistributeTarget(id) {
  const next = getDistributeTargets().map((item) => (
    item.id === id ? { ...item, enabled: !item.enabled } : item
  ))
  saveDistributeTargets(next)
  return next
}

function toggleReceiveDigest(id) {
  const next = getDistributeTargets().map((item) => (
    item.id === id ? { ...item, receiveDigest: !item.receiveDigest, enabled: true } : item
  ))
  saveDistributeTargets(next)
  return next
}

function addDistributeTarget({ name, chatId, sender, receiveDigest }) {
  const groupName = String(name || '').trim()
  if (!groupName) return { ok: false, message: '请填写群名称' }
  const nextChatId = String(chatId || '').trim()
  const group = {
    id: uid('g_'),
    name: groupName,
    type: 'external',
    enabled: true,
    webhook: '',
    chatId: nextChatId,
    sender: String(sender || '').trim(),
    scopes: ['wall'],
    categories: [],
    boards: ['*'],
    desc: '群主企微 + 同学普通微信的客户群',
    receiveDigest: receiveDigest !== false
  }
  saveDistributeTargets(getDistributeTargets().concat(group))
  return { ok: true, group }
}

function updateDistributeTarget(id, { name, chatId, sender } = {}) {
  const list = getDistributeTargets()
  const target = list.find((item) => item.id === id)
  if (!target) return { ok: false, message: '群不存在' }
  const nextName = name == null ? target.name : String(name).trim()
  if (!nextName) return { ok: false, message: '请填写群名称' }
  const nextChatId = chatId == null ? target.chatId : String(chatId).trim()
  const nextSender = sender == null ? target.sender : String(sender).trim()
  const next = list.map((item) => (
    item.id === id
      ? {
        ...item,
        name: nextName,
        chatId: nextChatId,
        sender: nextSender,
        type: 'external'
      }
      : item
  ))
  saveDistributeTargets(next)
  return { ok: true, group: next.find((item) => item.id === id) }
}

function getDistributeLogs() {
  return wx.getStorageSync(KEYS.DISTRIBUTE_LOGS) || []
}

function saveDistributeLogs(list) {
  wx.setStorageSync(KEYS.DISTRIBUTE_LOGS, list)
}

function pushDistributeLogs(entries) {
  saveDistributeLogs([...entries, ...getDistributeLogs()].slice(0, 100))
}

function buildDigestItems(list) {
  return list.map(({ type, post }) => {
    const card = distribute.buildShareCard(type, post)
    return {
      contentType: type,
      contentId: post.id,
      title: card.title,
      summary: card.summary,
      channel: card.channel,
      pagepath: card.pagepath,
      wecomPage: card.wecomPage,
      queuedAt: Date.now()
    }
  })
}

function getDigestQueue() {
  return wx.getStorageSync(KEYS.DIGEST_QUEUE) || []
}

function saveDigestQueue(list) {
  wx.setStorageSync(KEYS.DIGEST_QUEUE, list)
}

function getDigests() {
  return wx.getStorageSync(KEYS.DIGESTS) || []
}

function saveDigests(list) {
  wx.setStorageSync(KEYS.DIGESTS, list)
}

function getDigest(id) {
  const list = getDigests()
  if (!id) {
    return [...list].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null
  }
  return list.find((item) => item.id === id) || null
}

function digestProgress() {
  const queued = getDigestQueue()
  const digestGroups = getDistributeTargets().filter((group) => group.enabled && group.receiveDigest)
  return {
    size: DIGEST_SIZE,
    count: queued.length,
    remain: Math.max(0, DIGEST_SIZE - queued.length),
    queued,
    digestGroups,
    digestGroupText: digestGroups.length ? digestGroups.map((item) => item.name).join('、') : '尚未指定'
  }
}

function enqueueApproved(type, post) {
  if (type !== 'wall' || !moderation.isPublicStatus(post && post.reviewStatus)) {
    return { progress: digestProgress(), flushed: null }
  }
  const [item] = buildDigestItems([{ type, post }])
  const queue = getDigestQueue()
  if (queue.some((one) => one.contentType === type && one.contentId === post.id)) {
    return { progress: digestProgress(), flushed: null }
  }
  queue.push(item)
  saveDigestQueue(queue)
  if (queue.length >= DIGEST_SIZE) {
    return { progress: digestProgress(), flushed: flushDigest() }
  }
  return { progress: digestProgress(), flushed: null }
}

function flushDigest(force = false) {
  // 按入队时间 FIFO：够 10 条就取最早的一批发起，不再按热度重排
  const queue = getDigestQueue().slice().sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0))
  if (!queue.length) return null
  if (!force && queue.length < DIGEST_SIZE) return null
  const items = queue.slice(0, DIGEST_SIZE)
  saveDigestQueue(queue.slice(DIGEST_SIZE))
  const digest = {
    id: uid('dg_'),
    items,
    title: `本周精选 · ${items.length}条`,
    summary: items.map((item, index) => `${index + 1}.${item.title}`).join(' ').slice(0, 120),
    createdAt: Date.now()
  }
  digest.pagepath = `pages/digest/digest?id=${digest.id}`
  digest.sharePath = `/pages/digest/digest?id=${digest.id}`
  digest.wecomPage = `pages/digest/digest.html?id=${digest.id}`
  saveDigests([digest, ...getDigests()].slice(0, 50))

  const card = distribute.buildDigestCard(digest)
  const targets = getDistributeTargets().filter((group) => group.enabled && group.receiveDigest)
  const shareTargets = targets.length
    ? targets
    : [{ id: 'g_customer', name: '校园客户群', type: 'external', chatId: '', sender: '' }]
  const logs = shareTargets.map((group) => {
    const externalPayload = distribute.buildDigestExternalPayload(
      card,
      group.chatId ? [group.chatId] : [],
      group.sender
    )
    return {
      id: uid('dl_'),
      groupId: group.id,
      groupName: group.name,
      groupType: 'external',
      contentType: 'digest',
      contentId: digest.id,
      title: card.title,
      summary: card.summary,
      pagepath: card.pagepath,
      wecomPage: card.wecomPage,
      sharePath: `/${card.pagepath}`,
      items: items.map((item) => ({
        title: item.title,
        summary: item.summary,
        pagepath: item.pagepath,
        contentId: item.contentId
      })),
      payload: { external: externalPayload },
      itemCount: items.length,
      status: group.chatId ? 'confirm' : 'simulated',
      createdAt: Date.now()
    }
  })
  if (logs.length) pushDistributeLogs(logs)
  return { digest, card, logs }
}

function reviewContent(type, id, { approved, outcome, note } = {}) {
  const isForum = type === 'forum'
  const list = isForum ? getForumPosts() : getWallPosts()
  const target = list.find((item) => item.id === id)
  if (!target) return { ok: false, message: '内容不存在' }
  const nextStatus = outcome || (approved ? 'approved' : 'rejected')
  const allowed = ['approved', 'rejected', 'edit_required', 'manual_review', 'emergency_block', 'pending']
  if (!allowed.includes(nextStatus)) return { ok: false, message: '未知审核结果' }
  const next = list.map((item) => (
    item.id === id
      ? {
        ...item,
        reviewStatus: nextStatus,
        reviewOutcome: nextStatus,
        reviewNote: note || (nextStatus === 'approved' ? '人工审核通过' : item.reviewNote || ''),
        reviewedAt: Date.now()
      }
      : item
  ))
  isForum ? saveForumPosts(next) : saveWallPosts(next)
  const post = next.find((item) => item.id === id)
  let distribution = { progress: digestProgress(), flushed: null }
  if (nextStatus === 'approved') distribution = enqueueApproved(type, post)
  pushSecurityLog({
    level: nextStatus === 'emergency_block' ? 'critical' : 'info',
    type: 'manual_review',
    detail: `人工审帖 ${type}:${id} → ${nextStatus}`,
    hits: post.reviewRuleIds || []
  })
  return { ok: true, post, distribution }
}

function resetDemo() {
  seedData()
  return true
}

const WEEKLY_HOT_MAX = 20

function defaultWeeklyHot() {
  return {
    id: 'current',
    title: '园区热议',
    subtitle: '管理员精选热榜',
    enabled: true,
    items: [],
    updatedAt: 0
  }
}

function buildWeeklyHotItem(type, post, rank = 1) {
  const contentType = type === 'forum' ? 'forum' : 'wall'
  const card = distribute.buildShareCard(contentType, post)
  const title = String(card.title || (contentType === 'forum' ? post.title : wallHeadline(post)) || '').trim()
  const summary = String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return {
    contentType,
    contentId: post.id,
    title: title || summary.slice(0, 36),
    summary: card.summary || summary,
    oneLiner: title || summary.slice(0, 36),
    channel: card.channel,
    pagepath: card.pagepath,
    tag: homeFeed.primaryTag(post, contentType),
    likeCount: post.likeCount || 0,
    commentCount: post.commentCount || 0,
    rank,
    pinnedAt: Date.now()
  }
}

function buildSeedWeeklyHot(wallPosts, forumPosts) {
  const walls = (wallPosts || [])
    .map(withReview)
    .filter((item) => item.reviewStatus === 'approved')
    .map((post) => ({ type: 'wall', post, score: postHeatScore(post) }))
  const forums = (forumPosts || [])
    .map(withReview)
    .filter((item) => item.reviewStatus === 'approved')
    .map((post) => ({ type: 'forum', post, score: postHeatScore(post) }))
  const top = walls.concat(forums)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
  return {
    id: 'current',
    title: '园区热议',
    subtitle: '本周校园精选',
    enabled: true,
    schemaVersion: 2,
    items: top.map((item, index) => buildWeeklyHotItem(item.type, item.post, index + 1)),
    updatedAt: Date.now()
  }
}

function reRankWeeklyItems(items) {
  return (items || []).map((item, index) => ({ ...item, rank: index + 1 }))
}

function getWeeklyHotRaw() {
  return wx.getStorageSync(KEYS.WEEKLY_HOT) || defaultWeeklyHot()
}

function saveWeeklyHot(board) {
  const next = {
    ...defaultWeeklyHot(),
    ...board,
    id: 'current',
    schemaVersion: 2,
    items: reRankWeeklyItems(board.items || []),
    updatedAt: Date.now()
  }
  wx.setStorageSync(KEYS.WEEKLY_HOT, next)
  return next
}

function ensureWeeklyHotBoard() {
  const current = wx.getStorageSync(KEYS.WEEKLY_HOT)
  if (current && Array.isArray(current.items) && current.schemaVersion >= 2) return current
  const seeded = buildSeedWeeklyHot(getWallPosts(), getForumPosts())
  wx.setStorageSync(KEYS.WEEKLY_HOT, seeded)
  return seeded
}

function hydrateWeeklyHotItems(items) {
  const walls = getWallPosts()
  const forums = getForumPosts()
  const wallById = {}
  const forumById = {}
  walls.forEach((post) => { wallById[post.id] = post })
  forums.forEach((post) => { forumById[post.id] = post })
  return (items || []).map((item, index) => {
    const type = item.contentType === 'forum' ? 'forum' : 'wall'
    const post = type === 'forum' ? forumById[item.contentId] : wallById[item.contentId]
    if (!post || !homeFeed.isPublicPost(post)) {
      return { ...item, rank: index + 1, missing: true }
    }
    return {
      ...item,
      ...buildWeeklyHotItem(type, post, index + 1),
      pinnedAt: item.pinnedAt || Date.now(),
      missing: false
    }
  }).filter((item) => !item.missing)
}

function weeklyHotPreview(items, limit = 8) {
  return (items || []).slice(0, limit).map((item, index) => ({
    rank: item.rank || index + 1,
    contentType: item.contentType || 'wall',
    contentId: item.contentId,
    title: item.title,
    oneLiner: item.title || item.oneLiner || item.summary || '',
    tag: item.tag || '',
    channel: item.channel || ''
  }))
}

function getWeeklyHot({ includeDisabled = false, tab = '全部' } = {}) {
  const board = ensureWeeklyHotBoard()
  let items = hydrateWeeklyHotItems(board.items)
  const forumCount = items.filter((item) => item.contentType === 'forum').length
  const wallCount = items.filter((item) => item.contentType !== 'forum').length
  if (isForumSectionTab(tab)) items = items.filter((item) => item.contentType === 'forum')
  if (isWallSectionTab(tab)) items = items.filter((item) => item.contentType !== 'forum')
  items = reRankWeeklyItems(items)
  const allItems = hydrateWeeklyHotItems(board.items)
  const next = {
    ...board,
    items,
    allItems,
    preview: weeklyHotPreview(allItems, 8),
    count: items.length,
    totalCount: allItems.length,
    forumCount,
    wallCount
  }
  if (!includeDisabled && !board.enabled) {
    return { ...next, items: [], allItems: [], preview: [], count: 0, totalCount: 0, enabled: false }
  }
  return next
}

function listWeeklyHotCandidates({ keyword = '', contentType = '全部' } = {}) {
  const board = getWeeklyHotRaw()
  const picked = new Set((board.items || []).map((item) => `${item.contentType || 'wall'}:${item.contentId}`))
  const q = String(keyword || '').trim().toLowerCase()
  const result = []
  if (contentType === '全部' || isWallSectionTab(contentType)) {
    decorateList(
      sortByTime(getWallPosts().filter((item) => {
        if (item.reviewStatus !== 'approved') return false
        if (picked.has(`wall:${item.id}`)) return false
        if (!q) return true
        return `${item.title || ''} ${item.content || ''} ${item.tag || ''}`.toLowerCase().includes(q)
      })),
      'wall'
    ).forEach((post) => {
      result.push({
        id: post.id,
        contentType: 'wall',
        title: post.headline || post.title,
        summary: post.summary || String(post.content || '').slice(0, 80),
        tag: post.tag || '',
        likeCount: post.likeCount || 0,
        commentCount: post.commentCount || 0,
        createdAt: post.createdAt
      })
    })
  }
  if (contentType === '全部' || isForumSectionTab(contentType)) {
    decorateList(
      sortByTime(getForumPosts().filter((item) => {
        if (item.reviewStatus !== 'approved') return false
        if (picked.has(`forum:${item.id}`)) return false
        if (!q) return true
        return `${item.title || ''} ${item.content || ''} ${item.category || ''}`.toLowerCase().includes(q)
      })),
      'forum'
    ).forEach((post) => {
      result.push({
        id: post.id,
        contentType: 'forum',
        title: post.title,
        summary: String(post.content || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        tag: post.category || '',
        likeCount: post.likeCount || 0,
        commentCount: post.commentCount || 0,
        createdAt: post.createdAt
      })
    })
  }
  return result.sort((a, b) => b.createdAt - a.createdAt).slice(0, 40)
}

function addWeeklyHotItem(contentId, contentType = 'wall') {
  const type = contentType === 'forum' ? 'forum' : 'wall'
  const list = type === 'forum' ? getForumPosts() : getWallPosts()
  const post = list.find((item) => item.id === contentId)
  if (!post || post.reviewStatus !== 'approved') {
    return { ok: false, message: type === 'forum' ? '只能添加已通过的学习分享内容' : '只能添加已通过的互助广场内容' }
  }
  const board = getWeeklyHotRaw()
  if ((board.items || []).some((item) => item.contentId === contentId && (item.contentType || 'wall') === type)) {
    return { ok: false, message: '已在热榜中' }
  }
  if ((board.items || []).length >= WEEKLY_HOT_MAX) {
    return { ok: false, message: `热榜最多 ${WEEKLY_HOT_MAX} 条` }
  }
  const items = [buildWeeklyHotItem(type, post, 1), ...(board.items || [])]
  saveWeeklyHot({ ...board, items })
  return { ok: true, board: getWeeklyHot({ includeDisabled: true }), message: '已加入热榜' }
}

function removeWeeklyHotItem(contentId, contentType) {
  const board = getWeeklyHotRaw()
  const items = (board.items || []).filter((item) => {
    if (item.contentId !== contentId) return true
    if (contentType && (item.contentType || 'wall') !== contentType) return true
    return false
  })
  if (items.length === (board.items || []).length) {
    return { ok: false, message: '热榜中没有这条' }
  }
  saveWeeklyHot({ ...board, items })
  return { ok: true, board: getWeeklyHot({ includeDisabled: true }) }
}

function moveWeeklyHotItem(contentId, direction, contentType) {
  const board = getWeeklyHotRaw()
  const items = [...(board.items || [])]
  const index = items.findIndex((item) => (
    item.contentId === contentId
    && (!contentType || (item.contentType || 'wall') === contentType)
  ))
  if (index < 0) return { ok: false, message: '热榜中没有这条' }
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= items.length) return { ok: false, message: '已经到顶/底了' }
  const tmp = items[index]
  items[index] = items[target]
  items[target] = tmp
  saveWeeklyHot({ ...board, items })
  return { ok: true, board: getWeeklyHot({ includeDisabled: true }) }
}

function updateWeeklyHotMeta({ title, subtitle, enabled } = {}) {
  const board = getWeeklyHotRaw()
  const next = {
    ...board,
    title: title != null ? String(title).trim() || board.title : board.title,
    subtitle: subtitle != null ? String(subtitle).trim() : board.subtitle,
    enabled: enabled == null ? board.enabled : !!enabled
  }
  saveWeeklyHot(next)
  return { ok: true, board: getWeeklyHot({ includeDisabled: true }) }
}


// 黎安攻略（本地演示）：公众号推文 + 用户投稿混排，投稿默认待审核
const GUIDE_CATEGORIES = ['吃喝玩乐', '学习', '生活办事', '出行', '新生必看']
const GUIDE_PAGE_SIZE = 20

// 演示数据：一篇真实的公众号推文（可直接打开）、两条攻略页投稿、一条从首页帖子圈选的攻略
function seedGuides() {
  const now = Date.now()
  const hour = 3600 * 1000
  const post = (id, category, title, content, authorName, offset) => ({
    id, kind: 'post', category, title, content, summary: content.slice(0, 60), images: [],
    authorId: `u_demo_${id}`, authorName, authorAvatar: defaultProfile.stableAvatar(id),
    reviewStatus: 'approved', createdAt: now - offset, publishedAt: now - offset, viewCount: 0
  })
  return [
    {
      id: 'gd_demo_print',
      kind: 'article',
      category: '生活办事',
      title: '别再满园区找打印店了！黎安大学城打印地图+价格表，请收好~',
      // 演示用包内已有图片占位，不额外打包封面
      cover: '/images/mine-cover.jpg',
      articleUrl: 'https://mp.weixin.qq.com/s/Hhx0IFGOxZC92ziYU9NgUw',
      summary: '',
      reviewStatus: 'approved',
      createdAt: now - hour,
      publishedAt: now - hour,
      viewCount: 0
    },
    post('gd_demo_2', '吃喝玩乐', '学校后街 8 家小店，人均 20 吃到撑', '第三家的酸汤粉晚上十点还要排队，老板会多给一勺酸菜。往里走第五家的烤冷面也不错。', '晚风吹过操场', 2 * hour),
    {
      id: 'gd_demo_pick',
      kind: 'pick',
      refType: 'forum',
      refId: 'f_2',
      category: '学习',
      title: '高数期中复习资料共享，自取不谢',
      summary: '整理了一份高数上下册的错题和公式速记，覆盖极限、导数、积分和级数。',
      authorName: '',
      authorAvatar: '',
      reviewStatus: 'approved',
      createdAt: now - 3 * hour,
      publishedAt: now - 3 * hour,
      viewCount: 0
    },
    post('gd_demo_5', '生活办事', '校园卡丢了怎么办？补办只要 10 分钟', '带身份证去行政楼一楼，20 块工本费，当场拿新卡，原卡余额会自动转过来。', '小林', 8 * hour)
  ]
}

function getGuides() {
  let list = wx.getStorageSync(KEYS.GUIDES)
  if (!Array.isArray(list)) {
    list = seedGuides()
    wx.setStorageSync(KEYS.GUIDES, list)
  }
  return list
}

function guideKind(row) {
  if (row.kind === 'article' || row.kind === 'pick') return row.kind
  return 'post'
}

// 圈选的攻略：作者信息跟原帖走，原帖被删或不公开时不展示
function pickSource(row) {
  const list = row.refType === 'wall' ? getWallPosts() : getForumPosts()
  const post = list.find((item) => item.id === row.refId)
  return post && (!post.reviewStatus || post.reviewStatus === 'approved') ? post : null
}

function shapeGuide(row, withBody) {
  const user = getUser()
  const kind = guideKind(row)
  const article = kind === 'article'
  const source = kind === 'pick' ? pickSource(row) : null
  const item = {
    id: row.id,
    kind,
    refType: kind === 'pick' ? (row.refType === 'wall' ? 'wall' : 'forum') : '',
    refId: kind === 'pick' ? row.refId : '',
    category: row.category,
    title: row.title,
    summary: row.summary || String(row.content || '').slice(0, 60),
    cover: article ? row.cover : '',
    articleUrl: article ? row.articleUrl : '',
    authorName: article ? homeFeed.OFFICIAL_AUTHOR_NAME : ((source && source.authorName) || row.authorName),
    authorAvatar: article ? '' : ((source && source.authorAvatar) || row.authorAvatar),
    official: article,
    imageCount: (row.images || []).length,
    viewCount: row.viewCount || 0,
    publishedAt: row.publishedAt || row.createdAt,
    reviewStatus: row.reviewStatus,
    mine: !!(user && row.authorId === user.id)
  }
  if (withBody) {
    item.content = row.content || ''
    item.images = row.images || []
  }
  return item
}

function listGuides(payload = {}) {
  const category = GUIDE_CATEGORIES.indexOf(payload.category) >= 0 ? payload.category : ''
  const page = Math.max(0, Math.floor(Number(payload.page) || 0))
  const rows = getGuides()
    .filter((row) => row.reviewStatus === 'approved' && (!category || row.category === category))
    .filter((row) => guideKind(row) !== 'pick' || pickSource(row))
    .sort((a, b) => (b.sortAt || b.publishedAt || 0) - (a.sortAt || a.publishedAt || 0))
  const slice = rows.slice(page * GUIDE_PAGE_SIZE, (page + 1) * GUIDE_PAGE_SIZE)
  return {
    ok: true,
    categories: GUIDE_CATEGORIES.slice(),
    items: slice.map((row) => shapeGuide(row, false)),
    hasMore: rows.length > (page + 1) * GUIDE_PAGE_SIZE
  }
}

function getGuide(id) {
  const user = getUser()
  const row = getGuides().find((item) => item.id === id)
  if (!row || (row.reviewStatus !== 'approved' && row.authorId !== user.id)) {
    return { ok: false, message: '攻略不存在或还在审核' }
  }
  return { ok: true, guide: shapeGuide(row, true) }
}

function submitGuide(payload = {}) {
  const gate = getSpeakGate()
  if (!gate.ok) return { ok: false, code: gate.code, message: gate.message }
  const user = getUser()
  const category = String(payload.category || '').trim()
  const title = String(payload.title || '').trim()
  const content = String(payload.content || '').trim()
  if (GUIDE_CATEGORIES.indexOf(category) < 0) return { ok: false, message: '请选择分类' }
  if (!title) return { ok: false, message: '请填写标题' }
  if (title.length > 40) return { ok: false, message: '标题最多 40 个字' }
  if (content.length < 10) return { ok: false, message: '正文至少写 10 个字' }
  if (content.length > 3000) return { ok: false, message: '正文最多 3000 个字' }
  const guideFingerprint = (item) => security.contentFingerprint(item.category, item.title, item.content)
  if (!user.postWhitelist
    && security.hasDuplicateContent(getGuides(), user.id, guideFingerprint({ category, title, content }), guideFingerprint)) {
    return { ok: false, code: 'DUPLICATE', message: '请勿短时间重复投稿相同内容' }
  }
  if (!user.postWhitelist) {
    const limit = consumeRateLimit('post')
    if (!limit.ok) return limit
  }
  const review = runContentReview({ title, content, contentType: 'guide', category, channel: category })
  const blocked = [moderation.OUTCOMES.REJECT, moderation.OUTCOMES.EMERGENCY_BLOCK, moderation.OUTCOMES.EDIT_REQUIRED]
    .indexOf(review.outcome) >= 0
  if (blocked) return { ok: false, code: 'REJECTED', message: review.message || '内容不符合规范，无法投稿' }
  const now = Date.now()
  const guide = {
    id: uid('gd_'),
    kind: 'post',
    category,
    title,
    content,
    summary: content.slice(0, 60),
    images: payload.images || [],
    authorId: user.id,
    authorName: user.nickname,
    authorAvatar: defaultProfile.resolveAvatar(user.avatar, user.id),
    reviewStatus: 'pending',
    createdAt: now,
    publishedAt: 0,
    viewCount: 0
  }
  wx.setStorageSync(KEYS.GUIDES, [guide].concat(getGuides()))
  return { ok: true, guide: shapeGuide(guide, false), message: '已投稿，审核通过后会出现在黎安攻略' }
}

module.exports = {
  GUIDE_CATEGORIES,
  listGuides,
  getGuide,
  submitGuide,
  FORUM_CATEGORIES,
  HOME_TOPICS: homeFeed.HOME_TOPICS,
  OTHER_TOPIC: homeFeed.OTHER_TOPIC,
  OFFICIAL_TOPIC: homeFeed.OFFICIAL_TOPIC,
  DEFAULT_HOME_TAG: homeFeed.DEFAULT_HOME_TAG,
  normalizeTopic: homeFeed.normalizeTopic,
  publicWeeklySubtitle: homeFeed.publicWeeklySubtitle,
  WALL_BOARDS,
  SECTION_LABELS,
  sectionLabel,
  WALL_TAGS,
  WALL_DEAL_STATUSES,
  wallDealStatusLabel,
  normalizeWallDealStatus,
  CONTACT_TYPES,
  CONTACT_FEEDBACK_REASONS,
  REPORT_REASONS,
  REPORT_THRESHOLD,
  CONTACT_ALLOWED_CHANNELS: moderation.CONTACT_ALLOWED_CHANNELS,
  needsWallContact,
  contactTypeLabel,
  contactFeedbackReasonLabel,
  validateWallContact,
  reviewStatusLabel: moderation.reviewStatusLabel,
  wallHeadline,
  wallSummary,
  ensureInit,
  getUser,
  updateUser,
  formatSchool,
  authorSchoolForUser,
  setShowSchoolTag,
  studentAuthStatusText,
  submitStudentAuth,
  listStudentAuthRequests,
  reviewStudentAuth,
  canSpeak,
  getSpeakGate,
  submitSchoolInfo,
  bindPhone,
  requestSchoolChange,
  listSchoolRequests,
  reviewSchoolChange,
  listForum,
  listWall,
  listHome,
  getPost,
  bumpView,
  createForumPost,
  createWallPost,
  updateWallDealStatus,
  revealWallContact,
  submitContactFeedback,
  submitReport,
  listReports,
  resolveReport,
  deletePost,
  toggleLike,
  toggleCommentLike,
  listComments,
  addComment,
  deleteComment,
  myPosts,
  myLiked,
  myComments,
  myReceivedComments,
  myReceivedLikes,
  getInboxBadges,
  markInboxSeen,
  getShareCode,
  generateSharePoster,
  validateSharePoster,
  listConversations,
  openOrCreateConversation,
  getConversation,
  listMessages,
  markConversationRead,
  sendMessage,
  getPublicProfile,
  listUserPosts,
  stats,
  adminOverview,
  DIGEST_SIZE,
  listContentReviews,
  reviewContent,
  enqueueApproved,
  digestProgress,
  flushDigest,
  getDigest,
  getDigests,
  WEEKLY_HOT_MAX,
  getWeeklyHot,
  listWeeklyHotCandidates,
  addWeeklyHotItem,
  removeWeeklyHotItem,
  moveWeeklyHotItem,
  updateWeeklyHotMeta,
  getDistributeTargets,
  toggleDistributeTarget,
  toggleReceiveDigest,
  addDistributeTarget,
  updateDistributeTarget,
  getFilterKeywords,
  addFilterKeyword,
  removeFilterKeyword,
  isLockedKeyword,
  listAccounts,
  setAccountStatus,
  listSecurityLogs,
  listContactViews,
  listContactFeedbacks,
  getDistributeLogs,
  listLexicons,
  addLexiconTerm,
  toggleLexiconTerm,
  removeLexiconTerm,
  getLexiconMeta,
  resetDemo
}
