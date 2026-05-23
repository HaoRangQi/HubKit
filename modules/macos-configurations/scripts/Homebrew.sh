#!/bin/zsh

# 脚本说明：
# 1. 适用于Intel架构macOS 14，默认shell为zsh环境
# 2. 使用zsh解释器执行，脚本语法兼容zsh
# 3. 检测Homebrew是否已安装，未安装则自动安装
# 4. 配置环境变量，确保/usr/local/bin在PATH中（Intel Mac默认路径）
# 5. 修改~/.zshrc，避免重复添加PATH配置，支持多次执行
# 6. 提示用户执行 source ~/.zshrc 以使配置生效
# 7. 安装完成后验证brew命令可用性

set -e

# Homebrew Intel Mac默认安装路径
BREW_PREFIX="/usr/local"

# 1. 检测当前默认shell（确认是否为zsh）
DEFAULT_SHELL=$(dscl . -read ~/ UserShell | awk '{print $2}')
echo "当前默认shell: $DEFAULT_SHELL"

if [[ "$DEFAULT_SHELL" != "/bin/zsh" ]]; then
  echo "警告：当前默认shell不是 /bin/zsh，脚本以zsh配置为主，可能不适用其他shell。"
fi

# 2. 检查是否已安装Homebrew
if command -v brew >/dev/null 2>&1; then
  echo "检测到已安装Homebrew，路径：$(command -v brew)"
else
  echo "未检测到Homebrew，开始安装..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  echo "Homebrew安装完成。"
fi

# 3. 配置环境变量，确保/usr/local/bin在PATH中（Intel Mac默认路径）
ZSHRC="$HOME/.zshrc"
BREW_PATH_EXPORT="export PATH=\"$BREW_PREFIX/bin:\$PATH\""

# 判断是否已添加Homebrew路径，避免重复添加
if ! grep -Fq "$BREW_PATH_EXPORT" "$ZSHRC"; then
  echo "" >> "$ZSHRC"
  echo "# Homebrew路径配置，自动添加" >> "$ZSHRC"
  echo "$BREW_PATH_EXPORT" >> "$ZSHRC"
  echo "已将Homebrew路径添加到 $ZSHRC"
  echo "请执行 'source $ZSHRC' 或重新打开终端以使配置生效。"
else
  echo "Homebrew路径已存在于 $ZSHRC，无需重复添加。"
fi

# 4. 验证brew命令是否可用
if command -v brew >/dev/null 2>&1; then
  echo "Homebrew安装及配置成功！版本信息："
  brew --version
else
  echo "警告：brew命令不可用，请检查安装及环境变量配置。"
  exit 1
fi
