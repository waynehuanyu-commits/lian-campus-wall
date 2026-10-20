/**
 * 评论树：支持多级 parentId 回复 + 图片
 */

const COMMENT_IMAGE_MAX = 3
const COMMENT_INDENT_MAX = 5
/** 每层楼默认露出的回复数，超出可折叠 */
const REPLY_PREVIEW_COUNT = 2
/** 详情页默认露出的一级评论楼层数 */
const ROOT_PREVIEW_COUNT = 8

function normalizeComment(item = {}) {
  return {
    ...item,
    parentId: item.parentId || '',
    replyToId: item.replyToId || '',
    replyToName: item.replyToName || '',
    images: Array.isArray(item.images) ? item.images.filter(Boolean) : [],
    depth: Number(item.depth) || 0,
    likeCount: Number(item.likeCount) || 0,
    liked: !!item.liked
  }
}

function shapeRow(node, formatTime, depth = 0) {
  const indent = Math.min(depth, COMMENT_INDENT_MAX)
  return {
    id: node.id,
    content: node.content || '',
    authorId: node.authorId,
    authorName: node.authorName,
    authorAvatar: node.authorAvatar,
    createdAt: node.createdAt,
    parentId: node.parentId || '',
    replyToId: node.replyToId || '',
    replyToName: node.replyToName || '',
    images: node.images || [],
    depth: indent,
    depthClass: `depth-${indent}`,
    timeText: typeof formatTime === 'function' ? formatTime(node.createdAt) : '',
    hasImages: !!(node.images && node.images.length),
    mine: !!node.mine,
    canDelete: !!node.canDelete,
    likeCount: Number(node.likeCount) || 0,
    liked: !!node.liked
  }
}

function buildCommentTree(list = []) {
  const nodes = (list || []).map((item) => ({
    ...normalizeComment(item),
    children: []
  }))
  const byId = {}
  nodes.forEach((node) => {
    byId[node.id] = node
  })
  const roots = []
  nodes.forEach((node) => {
    if (node.parentId && byId[node.parentId]) {
      byId[node.parentId].children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

function flattenReplies(children = [], formatTime, depth = 1, out = []) {
  ;(children || []).forEach((child) => {
    out.push(shapeRow(child, formatTime, depth))
    flattenReplies(child.children || [], formatTime, depth + 1, out)
  })
  return out
}

function buildCommentGroups(list = [], formatTime) {
  const roots = buildCommentTree(list)
  return roots.map((root, index) => {
    const replies = flattenReplies(root.children || [], formatTime, 1, [])
    return {
      id: root.id,
      root: shapeRow(root, formatTime, 0),
      replies,
      replyCount: replies.length,
      likeCount: Number(root.likeCount) || 0,
      createdAt: root.createdAt || 0,
      order: index,
      expanded: false
    }
  })
}

function sortCommentGroups(groups = [], sort = 'earliest') {
  const list = (groups || []).slice()
  if (sort === 'likes') {
    return list.sort((a, b) => (b.likeCount - a.likeCount) || (a.order - b.order))
  }
  if (sort === 'comments') {
    return list.sort((a, b) => (b.replyCount - a.replyCount) || (a.order - b.order))
  }
  if (sort === 'latest') {
    return list.sort((a, b) => (b.createdAt - a.createdAt) || (a.order - b.order))
  }
  // earliest
  return list.sort((a, b) => (a.createdAt - b.createdAt) || (a.order - b.order))
}

function visibleRepliesForGroup(group) {
  const replies = (group && group.replies) || []
  if (!replies.length) {
    return { shown: [], hiddenCount: 0, canExpand: false, canCollapse: false }
  }
  const preview = Math.max(1, REPLY_PREVIEW_COUNT)
  if (replies.length <= preview) {
    return {
      shown: replies,
      hiddenCount: 0,
      canExpand: false,
      canCollapse: false
    }
  }
  if (group && group.expanded) {
    return {
      shown: replies,
      hiddenCount: 0,
      canExpand: false,
      canCollapse: true
    }
  }
  return {
    shown: replies.slice(0, preview),
    hiddenCount: replies.length - preview,
    canExpand: true,
    canCollapse: false
  }
}

function decorateCommentGroups(groups = [], sort = 'earliest') {
  return sortCommentGroups(groups, sort).map((group) => {
    const vis = visibleRepliesForGroup(group)
    return {
      ...group,
      shownReplies: vis.shown,
      hiddenCount: vis.hiddenCount,
      canExpand: vis.canExpand,
      canCollapse: vis.canCollapse
    }
  })
}

/** 一级评论过多时截断；展开后可收起 */
function sliceRootCommentGroups(groups = [], options = {}) {
  const list = Array.isArray(groups) ? groups : []
  const rootLimit = Number(options.rootLimit) > 0 ? Number(options.rootLimit) : ROOT_PREVIEW_COUNT
  const listExpanded = !!options.listExpanded
  if (listExpanded || list.length <= rootLimit) {
    return {
      groups: list,
      hiddenRootCount: 0,
      canExpandMore: false,
      canCollapseMore: listExpanded && list.length > rootLimit
    }
  }
  return {
    groups: list.slice(0, rootLimit),
    hiddenRootCount: list.length - rootLimit,
    canExpandMore: true,
    canCollapseMore: false
  }
}

function countAllComments(groups = []) {
  return (groups || []).reduce((sum, group) => sum + 1 + ((group.replies && group.replies.length) || 0), 0)
}

function expandGroupForTarget(groups = [], commentId = '') {
  const target = String(commentId || '')
  if (!target) return groups
  return (groups || []).map((group) => {
    if (String(group.id) === target) return { ...group, expanded: true }
    if ((group.replies || []).some((item) => String(item.id) === target)) {
      return { ...group, expanded: true }
    }
    return group
  })
}

function flattenCommentThread(list = [], formatTime) {
  const roots = buildCommentTree(list)
  const out = []
  const walk = (node, depth) => {
    out.push(shapeRow(node, formatTime, depth))
    ;(node.children || []).forEach((child) => walk(child, depth + 1))
  }
  roots.forEach((root) => walk(root, 0))
  return out
}

module.exports = {
  COMMENT_IMAGE_MAX,
  COMMENT_INDENT_MAX,
  REPLY_PREVIEW_COUNT,
  ROOT_PREVIEW_COUNT,
  normalizeComment,
  buildCommentTree,
  buildCommentGroups,
  sortCommentGroups,
  decorateCommentGroups,
  sliceRootCommentGroups,
  visibleRepliesForGroup,
  countAllComments,
  expandGroupForTarget,
  flattenCommentThread
}
