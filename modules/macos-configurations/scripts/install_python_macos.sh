#!/usr/bin/env bash

# 如果任何命令执行失败，立即退出脚本
set -e

echo "脚本开始：检查并安装/升级 Python 3 (macOS)"
echo "-----------------------------------------"

# 检查 Python 3 是否已安装并且可以正常工作
echo "步骤 1: 检查现有的 Python 3 安装..."
if command -v python3 &>/dev/null && python3 --version &>/dev/null; then
    PYTHON_VERSION_OUTPUT=$(python3 --version 2>&1)
    # python3 --version 可能输出多行 (例如警告信息)，我们只取第一行版本号
    PYTHON_VERSION=$(echo "$PYTHON_VERSION_OUTPUT" | head -n 1)
    echo "检测到 Python 3 已安装并且工作正常。"
    echo "版本信息: $PYTHON_VERSION"
    
    # 检查 Homebrew 是否已安装，用于后续可能的升级
    if command -v brew &>/dev/null; then
        # 获取 Homebrew 中最新的 Python 版本信息
        echo "正在检查是否有可用的 Python 更新..."
        brew update > /dev/null
        LATEST_PYTHON_INFO=$(brew info python3)
        LATEST_PYTHON_VERSION=$(echo "$LATEST_PYTHON_INFO" | grep -m 1 "python@" | awk '{print $1}' | sed 's/python@//')
        
        # 提取当前 Python 版本号（去掉 "Python " 前缀）
        CURRENT_VERSION=$(echo "$PYTHON_VERSION" | sed 's/Python //')
        
        echo "当前 Python 版本: $CURRENT_VERSION"
        echo "最新 Python 版本: $LATEST_PYTHON_VERSION"
        
        # 比较版本号（简化比较，仅比较主要版本号）
        CURRENT_MAJOR=$(echo "$CURRENT_VERSION" | cut -d. -f1)
        LATEST_MAJOR=$(echo "$LATEST_PYTHON_VERSION" | cut -d. -f1)
        
        if [ "$CURRENT_MAJOR" -lt "$LATEST_MAJOR" ]; then
            echo "您的 Python 版本不是最新的主要版本。"
            read -p "是否要升级到最新版本的 Python? (y/n): " UPGRADE_CHOICE
            if [[ "$UPGRADE_CHOICE" =~ ^[Yy]$ ]]; then
                echo "开始升级 Python..."
                brew install python@$LATEST_MAJOR
                
                # 验证升级后的版本
                if command -v python3 &>/dev/null && python3 --version &>/dev/null; then
                    NEW_PYTHON_VERSION=$(python3 --version 2>&1 | head -n 1)
                    echo "Python 升级成功！"
                    echo "新版本: $NEW_PYTHON_VERSION"
                else
                    echo "Python 升级后验证失败。请检查 Homebrew 的输出日志。"
                fi
            else
                echo "您选择不升级 Python。"
            fi
        else
            # 如果主要版本相同，检查次要版本
            CURRENT_MINOR=$(echo "$CURRENT_VERSION" | cut -d. -f2)
            LATEST_MINOR=$(echo "$LATEST_PYTHON_VERSION" | cut -d. -f2)
            
            if [ "$CURRENT_MINOR" -lt "$LATEST_MINOR" ]; then
                echo "您的 Python 有可用的次要版本更新。"
                read -p "是否要升级到最新的次要版本? (y/n): " UPGRADE_CHOICE
                if [[ "$UPGRADE_CHOICE" =~ ^[Yy]$ ]]; then
                    echo "开始升级 Python..."
                    brew upgrade python3
                    
                    # 验证升级后的版本
                    if command -v python3 &>/dev/null && python3 --version &>/dev/null; then
                        NEW_PYTHON_VERSION=$(python3 --version 2>&1 | head -n 1)
                        echo "Python 升级成功！"
                        echo "新版本: $NEW_PYTHON_VERSION"
                    else
                        echo "Python 升级后验证失败。请检查 Homebrew 的输出日志。"
                    fi
                else
                    echo "您选择不升级 Python。"
                fi
            else
                echo "您的 Python 已经是最新版本。"
            fi
        fi
    else
        echo "未检测到 Homebrew。如需升级 Python，建议先安装 Homebrew。"
        read -p "是否要安装 Homebrew 并检查 Python 更新? (y/n): " INSTALL_HOMEBREW
        if [[ "$INSTALL_HOMEBREW" =~ ^[Yy]$ ]]; then
            echo "将继续安装 Homebrew 并检查 Python 更新..."
        else
            echo "您选择不安装 Homebrew。Python 将保持当前版本。"
            echo "-----------------------------------------"
            echo "脚本执行完毕。"
            exit 0
        fi
    fi
else
    echo "未找到可工作的 Python 3 (命令 'python3' 不存在或 'python3 --version' 执行失败)。"
    echo "将尝试通过 Homebrew 安装 Python 3。"
fi

echo ""
echo "步骤 2: 检查并安装 Homebrew..."
# 检查 Homebrew 是否已安装
if ! command -v brew &>/dev/null; then
    echo "未检测到 Homebrew。现在开始安装 Homebrew..."
    echo "Homebrew 安装过程可能需要您输入管理员密码并进行确认。"
    echo "请遵循屏幕上的提示完成 Homebrew 安装。"
    # 从官方源安装 Homebrew
    # 此命令会执行 Homebrew 的安装脚本
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    echo "Homebrew 安装脚本执行完毕。"
    echo "配置 Homebrew 环境以便在当前 Shell 会话中使用..."

    # Homebrew 安装后，需要将其路径添加到 shell 环境中
    # Apple Silicon (arm64) Macs 通常将 Homebrew 安装在 /opt/homebrew
    # Intel Macs 通常将 Homebrew 安装在 /usr/local
    # uname -m 会输出 arm64 或 x86_64
    if [[ "$(uname -m)" == "arm64" ]] && [ -x /opt/homebrew/bin/brew ]; then
        # Apple Silicon
        echo "检测到 Apple Silicon (arm64) 架构。"
        echo "正在为当前会话配置 Homebrew 环境 (路径: /opt/homebrew)..."
        eval "$(/opt/homebrew/bin/brew shellenv)"
        echo "为了使 Homebrew 永久可用, 请确保以下命令已添加到您的 shell 配置文件中 (例如 ~/.zshrc 或 ~/.bash_profile):"
        echo '  eval "$(/opt/homebrew/bin/brew shellenv)"'
        echo "您可能需要重新启动终端或执行 'source ~/.zshrc' (或相应配置文件) 来使更改生效。"
    elif [[ "$(uname -m)" == "x86_64" ]] && [ -x /usr/local/bin/brew ]; then
        # Intel
        echo "检测到 Intel (x86_64) 架构。"
        echo "正在为当前会话配置 Homebrew 环境 (路径: /usr/local)..."
        eval "$(/usr/local/bin/brew shellenv)"
        echo "为了使 Homebrew 永久可用, 请确保以下命令已添加到您的 shell 配置文件中 (例如 ~/.zshrc 或 ~/.bash_profile):"
        echo '  eval "$(/usr/local/bin/brew shellenv)"'
        echo "您可能需要重新启动终端或执行 'source ~/.zshrc' (或相应配置文件) 来使更改生效。"
    else
        echo "无法自动确定 Homebrew 的安装路径或 'brew' 命令不可执行。"
        echo "请手动按照 Homebrew 安装完成后的提示，将 Homebrew 添加到您的 PATH 环境变量中。"
    fi

    # 再次验证 brew 命令是否可用
    if ! command -v brew &>/dev/null; then
        echo "错误：Homebrew 安装后，'brew' 命令在当前 PATH 中仍不可用。"
        echo "请检查 Homebrew 的安装说明，并确保其已正确添加到您的 shell 环境中，然后重新运行此脚本。"
        exit 1
    fi
    echo "Homebrew 安装成功并已为当前会话配置。"
else
    echo "Homebrew 已安装。"
fi

echo ""
echo "步骤 3: 使用 Homebrew 安装/更新 Python 3..."
echo "正在更新 Homebrew (这可能需要一些时间)..."
brew update

echo "正在安装 Python 3 (如果已安装，Homebrew 会处理更新)..."
brew install python3

echo ""
echo "步骤 4: 验证 Python 3 安装..."
if command -v python3 &>/dev/null && python3 --version &>/dev/null; then
    PYTHON_VERSION_POST_INSTALL_OUTPUT=$(python3 --version 2>&1)
    PYTHON_VERSION_POST_INSTALL=$(echo "$PYTHON_VERSION_POST_INSTALL_OUTPUT" | head -n 1)
    echo "Python 3 成功安装/更新！"
    echo "当前 Python 3 版本: $PYTHON_VERSION_POST_INSTALL"
    echo "Homebrew 通常会自动将 Python 3 的可执行文件链接到您的 PATH。"
    echo "您可以通过运行 'which python3' 和 'python3 --version' 来验证。"
else
    echo "错误：Python 3 安装失败或安装后无法找到。"
    echo "请检查上面 Homebrew 的输出日志以获取详细信息。"
    exit 1
fi

echo "-----------------------------------------"
echo "Python 3 安装/升级脚本执行完毕。"
exit 0