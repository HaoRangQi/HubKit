#!/bin/bash

# HubKit + zsh-config 集成测试脚本

echo "=========================================="
echo "HubKit 模块集成测试"
echo "=========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 测试函数
test_step() {
  echo -e "${YELLOW}▶ $1${NC}"
}

test_pass() {
  echo -e "${GREEN}✓ $1${NC}"
}

test_fail() {
  echo -e "${RED}✗ $1${NC}"
  exit 1
}

# 1. 检查配置
test_step "检查 HubKit 配置"
if [ -f ~/.hubkit/config.json ]; then
  test_pass "配置文件存在"
  echo "配置内容:"
  cat ~/.hubkit/config.json | grep -A 5 "moduleDirs"
else
  test_fail "配置文件不存在，请运行 node setup-modules.js"
fi
echo ""

# 2. 检查模块配置
test_step "检查 zsh-config 模块配置"
if [ -f modules/zsh-config/.hubkit.json ]; then
  test_pass "模块配置文件存在"
  cat modules/zsh-config/.hubkit.json
else
  test_fail "模块配置文件不存在"
fi
echo ""

# 3. 列出模块
test_step "列出所有模块"
node dist/cli/index.js list | grep -A 3 "zsh-config"
if [ $? -eq 0 ]; then
  test_pass "zsh-config 模块已注册"
else
  test_fail "zsh-config 模块未找到"
fi
echo ""

# 4. 启动 zsh-config
test_step "启动 zsh-config 模块"
node dist/cli/index.js start zsh-config
if [ $? -eq 0 ]; then
  test_pass "模块启动成功"
  sleep 2
else
  test_fail "模块启动失败"
fi
echo ""

# 5. 检查状态
test_step "检查模块状态"
node dist/cli/index.js status zsh-config
if [ $? -eq 0 ]; then
  test_pass "状态查询成功"
else
  test_fail "状态查询失败"
fi
echo ""

# 6. 测试 HTTP 访问
test_step "测试 zsh-config Web 界面 (http://localhost:3002)"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002)
if [ "$HTTP_CODE" = "200" ]; then
  test_pass "Web 界面可访问 (HTTP $HTTP_CODE)"
else
  test_fail "Web 界面不可访问 (HTTP $HTTP_CODE)"
fi
echo ""

# 7. 查看日志
test_step "查看模块日志"
node dist/cli/index.js logs zsh-config --lines 5
echo ""

# 8. 停止模块
test_step "停止 zsh-config 模块"
node dist/cli/index.js stop zsh-config
if [ $? -eq 0 ]; then
  test_pass "模块停止成功"
  sleep 1
else
  test_fail "模块停止失败"
fi
echo ""

# 9. 验证已停止
test_step "验证模块已停止"
STATUS=$(node dist/cli/index.js status zsh-config | grep "状态:" | awk '{print $2}')
if [ "$STATUS" = "stopped" ]; then
  test_pass "模块已停止"
else
  test_fail "模块仍在运行"
fi
echo ""

echo "=========================================="
echo -e "${GREEN}✓ 所有测试通过！${NC}"
echo "=========================================="
echo ""
echo "快速命令:"
echo "  启动模块: node dist/cli/index.js start zsh-config"
echo "  访问界面: http://localhost:3002"
echo "  HubKit Dashboard: npm run web -- -p 3001"
echo ""
