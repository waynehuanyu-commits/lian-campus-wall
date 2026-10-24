# 运营自动化 · 云数据库接库

小程序**不能**直连数据库：集合权限为「客户端不可读写」（见 `cloud/collections.json`）。  
运营脚本、定时任务、独立后台与云函数一样，用 **腾讯云 API 密钥 + CloudBase Node SDK** 读写同一套云库。

## 1. 环境 ID

与线上一致（`utils/config.js`）：

- **TCB_ENV**：`lian-xiaozhan-prod-d6cdpfc393b83`

## 2. 给运营单独开 API 密钥（推荐）

1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)（与微信云开发绑定的同一主账号）。
2. **访问管理** → **用户** → **用户列表** → **新建用户**（如 `liaan-ops-automation`）。
3. **访问方式**：勾选「编程访问」，生成 **SecretId / SecretKey**（只显示一次，请妥善保存）。
4. **权限**：二选一  
   - **只读自动化**：`QcloudTCBReadOnlyAccess`  
   - **需要改库/脚本写数据**：`QcloudTCBFullAccess`（或自定义策略只放开指定集合）
5. 把 SecretId、SecretKey 交给脚本环境变量，**不要**写进 Git、不要贴群里。

子账号与线上审帖后台（`/opt/liaan-review/admin/.env`）可以共用同一套密钥，也可以分开，便于轮换和审计。

## 3. 本机 / CI 配置

```bash
cd ops
cp .env.example .env
# 编辑 .env，填入 TCB_ENV、TCB_SECRET_ID、TCB_SECRET_KEY

npm install
npm run ping    # 应输出 ok: true 和 users 数量
npm run stats   # 各集合文档数
```

若已在 `admin/.env` 配好 TCB 三项，可不建 `ops/.env`，脚本会自动读取 `admin/.env`（以及 `server/.env` 里的企微等，不会覆盖已有 TCB 变量）。

## 4. 在代码里读写

```javascript
const { getDb } = require('./lib/db')

async function example() {
  const db = getDb()
  const res = await db.collection('forum_posts').where({ reviewStatus: 'approved' }).limit(20).get()
  return res.data
}
```

与 `admin/lib/db.js` 相同 SDK，支持增删改查、云存储临时链接等（见 [CloudBase Node 文档](https://docs.cloudbase.net/api-reference/server/node/introduction)）。

## 5. 集合列表

`users`、`forum_posts`、`wall_posts`、`comments`、`likes`、`school_requests`、`keywords`、`lexicon_terms`、`security_logs`、`digest_queue`、`digests`、`weekly_hot`、`analytics_events`、`conversations`、`dm_messages`、`distribute_*`、`reports`、`meta` 等，以 `cloud/collections.json` 为准。

## 6. 注意

- 密钥泄露等于整库可被该策略访问，请用子账号 + 最小权限。
- 小程序端仍走云函数；**不要**把 SecretKey 放进小程序或前端仓库。
- 云存储欠费（HTTP 451）不影响数据库读写，但会影响图片 URL。
