#!/bin/bash
# Build the current checkout and deploy it to the NAS without replacing /data.
set -euo pipefail

IMAGE="bwvault:amd64"
CONTAINER="bwvault"
NAS="tycon@192.168.31.110"
DATA_DIR="/vol1/1000/services/data/bwvault"
STAMP="$(date +%Y%m%d-%H%M%S)"

if [ ! -f Dockerfile ] || [ ! -f package.json ]; then
  echo "请在 bitwarden-vault-manager 项目目录运行此脚本" >&2
  exit 1
fi

echo "[1/4] 构建 linux/amd64 镜像"
docker buildx build --platform linux/amd64 --load -t "$IMAGE" .

echo "[2/4] 传输镜像到 NAS"
docker save "$IMAGE" | ssh "$NAS" 'sudo -n docker load'

echo "[3/4] 替换容器并保留 $DATA_DIR"
ssh "$NAS" bash -s -- "$CONTAINER" "$IMAGE" "$DATA_DIR" "$STAMP" <<'REMOTE'
set -euo pipefail
container="$1"; image="$2"; data_dir="$3"; stamp="$4"
sudo -n mkdir -p "$data_dir"
if sudo -n docker ps -a --format '{{.Names}}' | grep -qx "$container"; then
  sudo -n docker stop "$container" >/dev/null
  sudo -n docker rename "$container" "${container}-before-${stamp}"
fi
sudo -n docker run -d --name "$container" --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -p 3443:3443 \
  -v "$data_dir:/data" -e BWVAULT_HOME=/data/session \
  --read-only --cap-drop ALL --security-opt no-new-privileges:true \
  --tmpfs /tmp:size=10M "$image" >/dev/null
for _ in $(seq 1 30); do
  status=$(sudo -n docker inspect --format '{{.State.Health.Status}}' "$container" 2>/dev/null || true)
  [ "$status" = healthy ] && exit 0
  [ "$status" = unhealthy ] && break
  sleep 1
done
sudo -n docker logs --tail 30 "$container" >&2
exit 1
REMOTE

echo "[4/4] 部署完成"
echo "HTTPS: https://192.168.31.110:3443/"
echo "会话、PIN、设备 ID 与自动登录凭据均保存在 $DATA_DIR"
