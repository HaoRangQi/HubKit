#!/bin/bash

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否为 root 用户
check_root() {
    if [ "$(id -u)" = "0" ]; then
        echo -e "${RED}请不要使用 root 用户运行此脚本${NC}"
        exit 1
    fi
}

# 检查系统要求
check_requirements() {
    echo -e "${GREEN}检查系统要求...${NC}"
    
    # 检查操作系统
    if [[ "$OSTYPE" != "darwin"* ]] && [[ "$OSTYPE" != "linux"* ]]; then
        echo -e "${RED}不支持的操作系统类型: $OSTYPE${NC}"
        exit 1
    fi
    
    # 检查是否安装了 git
    if ! command -v git >/dev/null 2>&1; then
        echo -e "${RED}请先安装 git${NC}"
        exit 1
    fi
    
    # 检查是否安装了 zsh
    if ! command -v zsh >/dev/null 2>&1; then
        echo -e "${YELLOW}未检测到 zsh，将为您安装...${NC}"
        if [[ "$OSTYPE" == "darwin"* ]]; then
            brew install zsh
        elif [[ "$OSTYPE" == "linux"* ]]; then
            if command -v apt-get >/dev/null 2>&1; then
                sudo apt-get update && sudo apt-get install -y zsh
            elif command -v yum >/dev/null 2>&1; then
                sudo yum install -y zsh
            else
                echo -e "${RED}无法安装 zsh，请手动安装${NC}"
                exit 1
            fi
        fi
    fi
}

# 备份现有的 .zshrc
backup_zshrc() {
    if [ -f "$HOME/.zshrc" ]; then
        echo -e "${GREEN}备份现有的 .zshrc 文件...${NC}"
        cp "$HOME/.zshrc" "$HOME/.zshrc.backup.$(date +%Y%m%d_%H%M%S)"
    fi
}

# 安装 oh-my-zsh
install_oh_my_zsh() {
    if [ -d "$HOME/.oh-my-zsh" ]; then
        echo -e "${YELLOW}检测到已安装 oh-my-zsh${NC}"
        return
    fi
    
    echo -e "${GREEN}开始安装 oh-my-zsh...${NC}"
    sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended
}

# 安装主题
install_theme() {
    echo -e "${GREEN}可选主题：${NC}"
    echo "1) robbyrussell (默认主题)"
    echo "2) agnoster (经典主题)"
    echo "3) powerlevel10k (强大的可自定义主题)"
    echo "4) af-magic (简洁主题)"
    echo "5) dracula (暗色主题)"
    echo "6) spaceship (现代简约主题)"
    echo "7) bureau (信息丰富主题)"
    echo "8) avit (简约优雅主题)"
    echo "9) bira (彩色提示主题)"
    echo "10) cloud (轻量简洁主题)"
    echo "11) 恢复默认主题"
    
    read -p "请选择主题编号 (1-11): " theme_choice
    
    case $theme_choice in
        1)
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="robbyrussell"/' "$HOME/.zshrc"
            ;;
        2)
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="agnoster"/' "$HOME/.zshrc"
            ;;
        3)
            if [ ! -d "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k" ]; then
                git clone --depth=1 https://github.com/romkatv/powerlevel10k.git "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k"
            fi
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="powerlevel10k\/powerlevel10k"/' "$HOME/.zshrc"
            ;;
        4)
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="af-magic"/' "$HOME/.zshrc"
            ;;
        5)
            if [ ! -d "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/dracula" ]; then
                git clone https://github.com/dracula/zsh.git "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/dracula"
                ln -s "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/dracula/dracula.zsh-theme" "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/dracula.zsh-theme"
            fi
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="dracula"/' "$HOME/.zshrc"
            ;;
        6)
            if [ ! -d "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/spaceship-prompt" ]; then
                git clone https://github.com/spaceship-prompt/spaceship-prompt.git "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/spaceship-prompt" --depth=1
                ln -s "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/spaceship-prompt/spaceship.zsh-theme" "${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/spaceship.zsh-theme"
            fi
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="spaceship"/' "$HOME/.zshrc"
            ;;
        7)
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="bureau"/' "$HOME/.zshrc"
            ;;
        8)
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="avit"/' "$HOME/.zshrc"
            ;;
        9)
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="bira"/' "$HOME/.zshrc"
            ;;
        10)
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="cloud"/' "$HOME/.zshrc"
            ;;
        11)
            sed -i '' 's/ZSH_THEME=".*"/ZSH_THEME="robbyrussell"/' "$HOME/.zshrc"
            ;;
        *)
            echo -e "${RED}无效的选择${NC}"
            return
            ;;
    esac
    
    echo -e "${GREEN}主题已更新，请重新打开终端或执行 source ~/.zshrc 使更改生效${NC}"
}

# 恢复原始设置
restore_original() {
    echo -e "${YELLOW}警告: 这将删除 oh-my-zsh 并恢复原始设置${NC}"
    read -p "是否继续？(y/n) " confirm
    
    if [ "$confirm" = "y" ]; then
        # 卸载 oh-my-zsh
        if [ -f "$HOME/.oh-my-zsh/tools/uninstall.sh" ]; then
            sh "$HOME/.oh-my-zsh/tools/uninstall.sh"
        fi
        
        # 恢复备份的 .zshrc
        latest_backup=$(ls -t "$HOME"/.zshrc.backup.* 2>/dev/null | head -n 1)
        if [ -n "$latest_backup" ]; then
            cp "$latest_backup" "$HOME/.zshrc"
            echo -e "${GREEN}已恢复备份的 .zshrc 文件${NC}"
        fi
        
        echo -e "${GREEN}已恢复原始设置${NC}"
    fi
}

# 主菜单
main_menu() {
    while true; do
        echo -e "\n${GREEN}=== Oh My Zsh 管理脚本 ===${NC}"
        echo "1) 安装 Oh My Zsh"
        echo "2) 选择主题"
        echo "3) 恢复原始设置"
        echo "4) 退出"
        
        read -p "请选择操作 (1-4): " choice
        
        case $choice in
            1)
                check_requirements
                backup_zshrc
                install_oh_my_zsh
                ;;
            2)
                if [ ! -d "$HOME/.oh-my-zsh" ]; then
                    echo -e "${RED}请先安装 Oh My Zsh${NC}"
                    continue
                fi
                install_theme
                ;;
            3)
                restore_original
                ;;
            4)
                echo -e "${GREEN}感谢使用！${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}无效的选择${NC}"
                ;;
        esac
    done
}

# 运行主程序
check_root
main_menu