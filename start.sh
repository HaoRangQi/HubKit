#!/bin/bash

# HubKit 快速启动脚本

echo "🚀 HubKit 快速启动"
echo ""

# 检查是否已构建
if [ ! -d "dist" ]; then
  echo "📦 首次运行，正在构建项目..."
  npm run build
  echo ""
fi

# 检查配置
if [ ! -f ~/.hubkit/config.json ]; then
  echo "⚙️  初始化配置..."
  node setup-modules.js
  echo ""
fi

# 显示菜单
echo "请选择操作:"
echo ""
echo "  1) 启动 HubKit Web Dashboard (端口 2281)"
echo "  2) 启动 zsh-config 模块 (端口 3002)"
echo "  3) 启动所有服务 (Dashboard + zsh-config)"
echo "  4) 列出所有模块"
echo "  5) 查看模块状态"
echo "  6) 停止所有模块"
echo "  7) 运行集成测试"
echo "  0) 退出"
echo ""
read -p "请输入选项 [0-7]: " choice

case $choice in
  1)
    echo ""
    echo "🌐 启动 HubKit Web Dashboard..."
    echo "访问地址: http://localhost:2281"
    npm run web -- -p 2281
    ;;
  2)
    echo ""
    echo "🔧 启动 zsh-config 模块..."
    node dist/cli/index.js start zsh-config
    echo ""
    echo "✓ zsh-config 已启动"
    echo "访问地址: http://localhost:3002"
    ;;
  3)
    echo ""
    echo "🚀 启动所有服务..."

    # 启动 zsh-config
    node dist/cli/index.js start zsh-config
    echo "✓ zsh-config 已启动 (http://localhost:3002)"

    # 启动 Dashboard
    echo "✓ 正在启动 Dashboard (http://localhost:2281)"
    echo ""
    npm run web -- -p 2281
    ;;
  4)
    echo ""
    node dist/cli/index.js list
    ;;
  5)
    echo ""
    echo "📊 模块状态:"
    echo ""
    node dist/cli/index.js status zsh-config
    ;;
  6)
    echo ""
    echo "🛑 停止所有模块..."
    node dist/cli/index.js stop zsh-config
    echo "✓ 所有模块已停止"
    ;;
  7)
    echo ""
    ./test-integration.sh
    ;;
  0)
    echo "👋 再见！"
    exit 0
    ;;
  *)
    echo "❌ 无效选项"
    exit 1
    ;;
esac
