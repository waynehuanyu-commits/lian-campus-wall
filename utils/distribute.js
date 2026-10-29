function excerpt(text, max = 80) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function wallHeadline(post) {
  if (post.title) return post.title
  if (post.tag === '出行拼车' && (post.routeFrom || post.routeTo)) {
    return `${post.routeFrom || '出发地'} → ${post.routeTo || '目的地'}`
  }
  return post.tag || '校园话题'
}

function buildShareCard(type, post, appid = 'touristappid') {
  const title = type === 'forum' ? post.title : wallHeadline(post)
  const summary = excerpt(post.content)
  const path = type === 'forum'
    ? 'pages/forum-detail/forum-detail'
    : 'pages/wall-detail/wall-detail'
  const query = `id=${post.id}`
  return {
    appid,
    title,
    summary,
    path,
    query,
    pagepath: `${path}?${query}`,
    wecomPage: `${path}.html?${query}`,
    channel: (type === 'forum' ? post.category : post.tag) || '校园话题'
  }
}

function matchTargets(type, post, targets) {
  return (targets || []).filter((group) => {
    if (!group.enabled) return false
    if (!(group.scopes || []).includes(type)) return false
    if (type === 'forum') {
      const cats = group.categories || []
      return cats.includes('*') || cats.includes(post.category)
    }
    const boards = group.boards || []
    return boards.includes('*') || boards.includes(post.tag)
  })
}

function buildRobotPayload(card) {
  return {
    msgtype: 'template_card',
    template_card: {
      card_type: 'text_notice',
      source: { desc: '校园墙' },
      main_title: {
        title: card.title,
        desc: card.summary
      },
      sub_title_text: `${card.channel} · 点击进入小程序阅读`,
      card_action: {
        type: 2,
        appid: card.appid,
        pagepath: card.pagepath
      }
    }
  }
}

function buildExternalGroupPayload(card, chatIdList) {
  return {
    chat_type: 'group',
    chat_id_list: chatIdList,
    text: {
      content: `${card.title}\n${card.summary}`
    },
    attachments: [
      {
        msgtype: 'miniprogram',
        miniprogram: {
          title: card.title,
          pic_media_id: 'MEDIA_ID',
          appid: card.appid,
          page: card.wecomPage
        }
      }
    ]
  }
}

function buildUrlLinkRequest(card) {
  return {
    path: card.path,
    query: card.query,
    expire_type: 1,
    expire_interval: 30
  }
}

function itemLines(items) {
  return (items || []).map((item, index) => {
    const summary = item.summary || '暂无摘要'
    return [
      `${index + 1}. 【${item.channel}】${item.title}`,
      `摘要：${summary}`,
      `小程序入口：${item.pagepath}`
    ].join('\n')
  })
}

function buildDigestCard(digest, appid = 'touristappid') {
  const items = digest.items || []
  const lines = itemLines(items)
  return {
    appid,
    title: digest.title,
    summary: digest.summary,
    markdown: [
      `**${digest.title}**`,
      '以下 10 条含标题、摘要与小程序入口。点击卡片进入汇总页，再点对应条目即可精准阅读。',
      '',
      lines.join('\n\n')
    ].join('\n'),
    text: [
      digest.title,
      digest.summary,
      '',
      lines.join('\n\n'),
      '',
      '点击下方小程序进入汇总页，点任意一条即可跳到对应内容页。'
    ].join('\n'),
    path: 'pages/digest/digest',
    query: `id=${digest.id}`,
    pagepath: `pages/digest/digest?id=${digest.id}`,
    wecomPage: `pages/digest/digest.html?id=${digest.id}`,
    items,
    itemUrlLinkRequests: items.map((item) => ({
      contentId: item.contentId,
      title: item.title,
      path: item.pagepath.split('?')[0],
      query: `id=${item.contentId}`,
      pagepath: item.pagepath,
      wecomPage: item.wecomPage,
      expire_type: 1,
      expire_interval: 30
    })),
    channel: '校园墙汇总'
  }
}

function buildDigestRobotPayload(card) {
  return {
    msgtype: 'template_card',
    template_card: {
      card_type: 'text_notice',
      source: { desc: '校园墙汇总' },
      main_title: {
        title: card.title,
        desc: card.summary
      },
      sub_title_text: `共 ${card.items.length} 条 · 标题 / 摘要 / 小程序入口`,
      card_action: {
        type: 2,
        appid: card.appid,
        pagepath: card.pagepath
      }
    }
  }
}

function buildDigestMarkdownPayload(card) {
  return {
    msgtype: 'markdown',
    markdown: {
      content: card.markdown
    }
  }
}

function buildDigestExternalPayload(card, chatIdList, sender) {
  const payload = {
    chat_type: 'group',
    chat_id_list: chatIdList || [],
    text: {
      content: (card.text || `${card.title}\n${card.summary}`).slice(0, 4000)
    },
    attachments: [
      {
        msgtype: 'miniprogram',
        miniprogram: {
          title: String(card.title || '黎安话事精选汇总').slice(0, 20),
          pic_media_id: 'MEDIA_ID',
          appid: card.appid,
          page: card.wecomPage
        }
      }
    ]
  }
  if (sender) payload.sender = sender
  return payload
}

module.exports = {
  excerpt,
  buildShareCard,
  matchTargets,
  buildRobotPayload,
  buildExternalGroupPayload,
  buildUrlLinkRequest,
  buildDigestCard,
  buildDigestRobotPayload,
  buildDigestMarkdownPayload,
  buildDigestExternalPayload
}
