# zsh Config Center

本地 zsh 可视化配置中心。它扫描现有 `~/.zshrc`、`~/.zprofile`、`~/.zshenv` 和 Oh My Zsh 自定义文件，解释当前配置，并通过托管文件安全写入常用配置。

## 启动

```sh
npm run dev
```

默认地址：

```text
http://localhost:3000
```

## 托管配置

应用代码在当前项目内，真实 zsh 配置默认写到：

```text
~/.config/zsh-config/
```

核心文件：

- `config.json`：结构化配置真源。
- `managed.zsh`：由应用生成，被 zsh 加载。
- `backups/`：保存或接入前的备份。

首次使用页面里的“接入托管配置”按钮，会创建托管目录，并在 `~/.zshrc` 中追加一行：

```sh
[[ -r "$HOME/.config/zsh-config/managed.zsh" ]] && source "$HOME/.config/zsh-config/managed.zsh"
```

应用不会大规模重写现有 `.zshrc`。

## 配置何时生效

保存改动会立即写入 `~/.config/zsh-config/managed.zsh`，但已经打开的终端不会自动获得新的 alias、PATH 或环境变量。这不是延迟，而是 shell 配置只在当前 zsh 进程加载时生效。

新开的终端会自动加载托管配置。当前终端想立刻生效，可以执行：

```sh
source ~/.config/zsh-config/managed.zsh
```

如果想完整重载 `.zshrc`，可以执行：

```sh
source ~/.zshrc
```

## 测试

```sh
npm test
```
