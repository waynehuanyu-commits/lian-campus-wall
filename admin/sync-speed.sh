#!/bin/bash
# 在 Mac 上执行：把加速补丁同步到新加坡审帖机并重启
set -e
HOST="${1:-agentuser@43.156.48.168}"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> 上传到 $HOST:/tmp/liaan-speed/"
ssh "$HOST" 'mkdir -p /tmp/liaan-speed'
scp "$DIR/lib/cache.js" "$DIR/lib/db.js" "$DIR/lib/service.js" "$DIR/public/app.js" \
  "$HOST:/tmp/liaan-speed/"

echo "==> 安装并重启"
ssh -t "$HOST" 'bash -s' <<'REMOTE'
set -e
sudo cp /tmp/liaan-speed/cache.js /opt/liaan-review/admin/lib/cache.js
sudo cp /tmp/liaan-speed/db.js /opt/liaan-review/admin/lib/db.js
sudo cp /tmp/liaan-speed/service.js /opt/liaan-review/admin/lib/service.js
sudo cp /tmp/liaan-speed/app.js /opt/liaan-review/admin/public/app.js
sudo chown agentuser:agentuser /opt/liaan-review/admin/lib/cache.js /opt/liaan-review/admin/lib/db.js /opt/liaan-review/admin/lib/service.js /opt/liaan-review/admin/public/app.js
sudo pkill -f "node.*server.js" || true
sleep 1
cd /opt/liaan-review/admin
setsid node server.js > "$HOME/liaan-admin.log" 2>&1 < /dev/null &
sleep 1
curl -s -o /dev/null -w "http %{http_code}\n" http://127.0.0.1:8787/
tail -n 5 "$HOME/liaan-admin.log"
REMOTE

echo "完成。浏览器强制刷新后台即可。"
