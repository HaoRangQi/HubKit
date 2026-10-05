#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
trap 'printf "\n按回车关闭窗口…"; read -r _hubkit_close' EXIT

printf 'HubKit Docker 控制入口：一次性安装\n\n'
command -v node >/dev/null || { printf '请先安装 Node.js。\n'; exit 1; }
command -v npm >/dev/null || { printf '请先安装 npm。\n'; exit 1; }
command -v docker >/dev/null || { printf '请先安装 OrbStack 或 Docker Desktop。\n'; exit 1; }
docker info >/dev/null 2>&1 || { printf '请先打开 OrbStack 或 Docker Desktop，然后重新双击本文件。\n'; exit 1; }

if [ ! -d node_modules ]; then npm ci; fi
npm run build
node dist/cli/index.js service install
docker compose up -d --build
hubkit_url="http://$(docker compose port hubkit 2281)/"
for attempt in {1..30}; do
  if curl --fail --silent --max-time 2 "$hubkit_url" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent --max-time 3 "$hubkit_url" >/dev/null || {
  printf '入口暂未就绪，请检查 Docker 中 hubkit 的日志和本机服务状态。\n'; exit 1;
}
printf '\n安装完成。以后在 OrbStack / Docker Desktop 中启停 hubkit 容器即可。\n'
printf '控制台：%s\n停止容器只关闭入口，Mac 上已启动的任务继续运行。\n' "$hubkit_url"
