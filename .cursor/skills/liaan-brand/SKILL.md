---
name: liaan-brand
description: 黎安话事网页设计系统。做网页 UI、改样式、美化论坛/广场/登录页时使用。风格来自 UI/UX Pro Max：Claymorphism（教育/青年社交）+ LMS 配色 + 简体中文字体。
---

# 黎安话事设计系统

依据 [Easy-Vibe Skills 美化课](https://datawhalechina.github.io/easy-vibe/zh-cn/stage-2/frontend/llm-skills-beautiful/) 和 UI/UX Pro Max 目录选定，不要再换成宣纸宋体、通用蓝卡片或紫色渐变。

## 美学风格

Claymorphism（克制版）：圆、厚、可按下去。给园区同学用的学习社区，不是儿童应用，所以不用粉彩玩具色。

## 字体

- 标题：Nunito 700（数字/英文）+ Noto Sans SC 700
- 正文：Noto Sans SC 400–500
- 禁止：Inter、Roboto、Arial、Noto Serif、IBM Plex 当展示字体

## 颜色（Pro Max · LMS）

- 主色 `#0D9488`，主色上文字 `#FFFFFF`（对比度按按钮白字处理）
- 点缀 `#D97706`（发帖、热榜、未读）
- 背景 `#F0FDFA`
- 文字 `#134E4A`
- 次文字 `#475569`
- 卡片 `#FFFFFF`
- 边框 `#99F6E4`
- 危险 `#DC2626`

## 布局

- 桌面：左侧导航 + 单栏信息流，左对齐，最大宽约 640px
- 信息流用一条白色列表，行间分割，不要每条帖子一张悬浮大卡
- 不要 Bento、不要杂志大标题、不要 ALL-CAPS 英文 kicker

## 动画

- 只做按下去：`active { transform: scale(0.97) }`，150ms
- 不要进场 stagger、不要每张卡 hover 上浮

## 细节

- 圆角：按钮/输入 16px，卡片 20px，头像圆形
- 按钮边框 2px solid 主色（幽灵按钮），主按钮实心主色
- 软阴影：`0 8px 20px rgba(13,148,136,0.12)`
- Logo「黎」用主色圆角方块，不要印章描边硬阴影

## 禁止

- 紫色渐变、Tailwind 默认蓝 `#2563EB` 当主色
- 宣纸底、宋体标题、朱砂、4px 黑色偏移阴影
- 玻璃拟态全屏紫雾
- 为装饰加英文小标签
