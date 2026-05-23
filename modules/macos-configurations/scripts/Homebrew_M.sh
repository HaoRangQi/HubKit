#!/bin/zsh
set -e

# 🔧 M芯片专用路径调整
BREW_PREFIX="/opt/homebrew"

# 1. 验证默认Shell
DEFAULT_SHELL=$(dscl . -read \~/ UserShell | awk '{print $2}')
echo "Current shell: $DEFAULT_SHELL"
if [[ "$DEFAULT_SHELL" != "/bin/zsh" ]]; then
  echo "Warning: Default shell is not zsh. Script focuses on zsh configuration."
fi

# 2. 前置路径权限处理（解决M芯片特殊权限要求[1][8]）
if [[ ! -d "$BREW_PREFIX" ]]; then
  echo "Creating Homebrew directory with proper permissions..."
  sudo mkdir -p $BREW_PREFIX
  sudo chown -R $(whoami) $BREW_PREFIX
fi

# 3. 安装Homebrew（官方命令）
if ! command -v brew >/dev/null; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  
  # 🔧 确保brew命令即时可用
  eval "$($BREW_PREFIX/bin/brew shellenv)"
fi

# 4. 环境变量配置（官方推荐方式[2][7][9]）
ZSHRC="$HOME/.zshrc"
SHELLENV_CMD="eval \"\$($BREW_PREFIX/bin/brew shellenv)\""

if ! grep -q "brew shellenv" "$ZSHRC"; then
  echo "\n# Homebrew environment (M-series)" >> "$ZSHRC"
  echo $SHELLENV_CMD >> "$ZSHRC"
  echo "Added Homebrew env to $ZSHRC"
else
  echo "Homebrew env already configured in $ZSHRC"
fi

# 5. 验证安装
if brew --version &>/dev/null; then
  echo "\n✅ Homebrew installed successfully:"
  brew --version
else
  echo "\n❌ Installation failed. Check permissions or run with debug:" >&2
  echo "   /bin/bash -x -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"" >&2
  exit 1
fi