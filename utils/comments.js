/**
 * 评论树：支持多级 parentId 回复 + 图片
 */

const COMMENT_IMAGE_MAX = 3
const COMMENT_INDENT_MAX = 5

function normalizeComment(item = {}) {
  return {
    ...item,
    parentId: item.parentId || '',
    replyToId: item.replyToId || '',
    replyToName: item.replyToName || '',
    images: Array.isArray(item.images) ? item.images.filter(Boolean).slice(0, COMMENT_IMAGE_MAX) : [],
    depth: Number(item.depth) || 0
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

function flattenCommentThread(list = [], formatTime) {
  const roots = buildCommentTree(list)
  const out = []
  const walk = (node, depth) => {
    const indent = Math.min(depth, COMMENT_INDENT_MAX)
    out.push({
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
      canDelete: !!node.canDelete
    })
    ;(node.children || []).forEach((child) => walk(child, depth + 1))
  }
  roots.forEach((root) => walk(root, 0))
  return out
}

module.exports = {
  COMMENT_IMAGE_MAX,
  COMMENT_INDENT_MAX,
  normalizeComment,
  buildCommentTree,
  flattenCommentThread
}
