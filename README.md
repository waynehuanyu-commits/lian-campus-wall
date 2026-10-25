# 黎安话事

微信小程序：学习分享 + 互助广场 + 黎安攻略。品牌名「黎安话事」。

上线架构：**用户端小程序 + 独立 Web 后台 + 微信云开发数据库**。学生只看到小程序；运营在电脑浏览器打开后台。

## 两端如何分开

| | 用户端小程序 | 独立后台 |
| --- | --- | --- |
| 入口 | 微信内打开，底部 Tab：首页 / 黎安攻略 / 消息 / 我的 | 浏览器访问 `admin` 服务，需登录 |
| 界面 | 品牌蓝社区风格（`#0A5CFF`） | 运营控制台 |
| 能力 | 浏览、发帖、评论（含匿名/点赞/举报）、攻略、学校认证、搜索 | 内容审帖、词库、账号处置、公众号推文、企微群发、黎安攻略、我的页封面、学校/学生认证 |
| 数据 | 云函数读写云库 | 云开发 Node SDK 读写同一云库 |
| 互相可见 | 无管理入口 | 不进入学生小程序 |

本地未配置云环境时，小程序仍可用本机 Storage 演示。上线必须打开云数据库，否则各手机数据不通。

## 上线步骤

1. 微信开发者工具开通 **云开发**，记下环境 ID  
2. 在云开发控制台创建集合（见 `cloud/collections.json`），权限全部设为 **客户端不可读写**（含 `comment_likes`、`guides`；`guides` 还需按交接说明建索引）  
3. **先**上传并部署云函数 `login`、`userApi`（否则点赞/攻略会报「未知操作」），**再**发前端  
4. 填写 `utils/config.js` 里的 `cloudEnvId`  
5. 复制 `admin/.env.example` 为 `admin/.env`，填入环境 ID、腾讯云 API 密钥，并设置 `ADMIN_PASSWORD`  
6. 启动独立后台：

```bash
cd admin
npm install
ADMIN_LOCAL=1 ADMIN_PASSWORD=admin123 npm start   # 本地演示
# 或云端：配齐 TCB_* 后 npm start
```

浏览器打开 `http://127.0.0.1:8787`。本地演示必须显式配 `ADMIN_PASSWORD`（代码里不再内置默认密码）。

**正式云库**：填齐 `TCB_ENV / TCB_SECRET_ID / TCB_SECRET_KEY`，并去掉 `ADMIN_LOCAL`；云库需有 `lexicon_terms` 集合。封面/攻略封面上传需要密钥对应账号有云存储写权限。

**运营自动化接库**：见 [`ops/README.md`](ops/README.md)（`npm run ping` / `npm run stats`）。

改版与上线清单见 [`改版交接说明.md`](改版交接说明.md)（以 2026-10-25 版为准）。

## 用户端功能

- **首页（学习分享）**：校园生活、学习交流、吐槽树洞、活动组队；独立搜索页；下滑吸顶分类
- **黎安攻略**：公众号推文 / 用户投稿 / 运营圈选帖子；分类筛选；投稿需学校认证
- **消息**：赞和收藏 / 评论和@ 切换列表；私信入口已下线
- **我的**：头像昵称、学校认证、发布/获赞统计；顶部可配园区封面图（后台「我的页封面」）
- **评论**：点赞/取消、匿名评论、「举报」（满 3 人转人工）
- **门槛**：浏览开放；发帖/评论/攻略投稿需先认证学校；学校只能手填全称
- **风控**：正文/评论允许留微信号、手机号、QQ、二维码图；诈骗、刷单、借贷、博彩、曝光隐私规则不变
- **园区热议**：原「每周精选」
- **分发**：校园墙满 10 条走企微客户群群发

## 如何本地跑用户端

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 选择「导入项目」，目录指向本文件夹
3. `utils/config.js` 的 `cloudEnvId` 留空，即用本地 Storage
4. 编译预览

## 目录

```text
app.js / app.json / app.wxss
pages/                 用户端（含 search、guide）
components/            含 campus-qr-card 等
cloudfunctions/        云函数 login / userApi
cloud/                 集合说明
admin/                 独立运营后台（含 lib/cover.js、lib/guides.js）
utils/
  config.js       云环境开关
  repo.js         本地 / 云端数据门面
  store.js        本地演示数据层
  cover.js        我的页封面
  nav-bar.js      自定义导航尺寸
server/wecom-distribute.js
```

`packageAdmin/` 是旧的小程序内管理端，已从 `app.json` 移除，上线不要再用。

## 企微自动群发（必须）

目标群：群主企微 + 同学普通微信，例如「群聊推送测试」。

1. 公司里能进企微后台的人，把 **企业ID、应用 Secret、群主账号** 发给开发者  
2. 开发者填进 `server/.env`，并在云开发控制台给云函数 `userApi` 配同样的环境变量  
3. 把出口 IP 加进自建应用「企业可信IP」（本机可用 `node server/check-wecom.js` 看 60020 原文里的 from ip）  
4. 后台「企微群发」拉取并绑定目标群，或运行 `node server/list-groups.js`  
5. 校园墙满 10 条 → 云函数自动创建企微群发 → 群主确认发送  

本地可先跑 `node server/send-to-group.js` 做一次试发。
