#!/bin/bash
# 把本机 admin/ + 依赖的 server/ 同步到新加坡审帖机并重启。不覆盖远端 .env。
# 用法：cd admin && ./deploy.sh
# 若腾讯云堡垒机要微信扫码，在本机终端跑本脚本并按提示扫码。
set -euo pipefail
HOST="${1:-agentuser@43.156.48.168}"
REMOTE_ROOT="/opt/liaan-review"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/.." && pwd)"

echo "==> 同步到 $HOST:$REMOTE_ROOT （保留远端 .env）"
ssh "$HOST" "mkdir -p /tmp/liaan-admin-deploy/admin /tmp/liaan-admin-deploy/server /tmp/liaan-admin-deploy/utils"

rsync -az --delete \
  --exclude node_modules \
  --exclude .env \
  --exclude data \
  --exclude '*.log' \
  "$DIR/" "$HOST:/tmp/liaan-admin-deploy/admin/"

rsync -az \
  --exclude node_modules \
  --exclude .env \
  --exclude '*.log' \
  "$ROOT/server/" "$HOST:/tmp/liaan-admin-deploy/server/"

# admin/lib 通过 ../../utils 引用这些模块
rsync -az \
  "$ROOT/utils/home-feed.js" \
  "$ROOT/utils/moderation.js" \
  "$ROOT/utils/security.js" \
  "$ROOT/utils/distribute.js" \
  "$ROOT/utils/util.js" \
  "$HOST:/tmp/liaan-admin-deploy/utils/"

echo "==> 安装到 $REMOTE_ROOT 并重启"
ssh -t "$HOST" "REMOTE_ROOT='$REMOTE_ROOT' bash -s" <<'REMOTE'
set -euo pipefail
sudo mkdir -p "$REMOTE_ROOT/admin" "$REMOTE_ROOT/server" "$REMOTE_ROOT/utils"
# 备份远端 .env
if [ -f "$REMOTE_ROOT/admin/.env" ]; then
  sudo cp "$REMOTE_ROOT/admin/.env" /tmp/liaan-admin.env.bak
fi
sudo rsync -a --delete \
  --exclude .env \
  --exclude node_modules \
  --exclude data \
  /tmp/liaan-admin-deploy/admin/ "$REMOTE_ROOT/admin/"
sudo rsync -a /tmp/liaan-admin-deploy/server/ "$REMOTE_ROOT/server/"
if [ -d /tmp/liaan-admin-deploy/utils ]; then
  sudo rsync -a /tmp/liaan-admin-deploy/utils/ "$REMOTE_ROOT/utils/"
fi
if [ -f /tmp/liaan-admin.env.bak ]; then
  sudo cp /tmp/liaan-admin.env.bak "$REMOTE_ROOT/admin/.env"
fi
sudo chown -R agentuser:agentuser "$REMOTE_ROOT/admin" "$REMOTE_ROOT/server" "$REMOTE_ROOT/utils" || true
cd "$REMOTE_ROOT/admin"
npm install --omit=dev
sudo pkill -f "node.*server.js" || true
sleep 1
setsid node server.js > "$HOME/liaan-admin.log" 2>&1 < /dev/null &
sleep 2
curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:8787/ || true
tail -n 20 "$HOME/liaan-admin.log" || true
REMOTE

echo "完成。浏览器强制刷新后台，到「我的页封面」试上传一张图。"
