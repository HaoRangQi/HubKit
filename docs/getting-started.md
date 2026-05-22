# 快速开始指南

本指南帮助你快速接入新模块到中控台。

## 接入步骤

### 1. 准备你的脚本

确保你的脚本可以独立运行：

```bash
# Node.js
node your-script.js

# Python
python3 your-script.py

# Shell
bash your-script.sh
```

### 2. 创建模块元数据

在脚本目录下创建 `module.json`：

```json
{
  "id": "my-module",
  "name": "我的模块",
  "description": "模块功能描述",
  "type": "nodejs",
  "scriptPath": "./index.js",
  "autoStart": true,
  "enabled": true
}
```

**字段说明**：
- `id`: 模块唯一标识（小写字母、数字、连字符）
- `name`: 模块显示名称
- `description`: 模块功能描述（可选）
- `type`: 脚本类型（`nodejs` | `python` | `shell`）
- `scriptPath`: 脚本文件路径（相对于 module.json）
- `autoStart`: 是否开机自启（`true` | `false`）
- `enabled`: 是否启用模块（`true` | `false`）

### 3. 注册模块

将模块目录放到中控台的 `modules/` 目录下：

```bash
mkdir -p ~/.hub/modules/my-module
cp module.json ~/.hub/modules/my-module/
cp your-script.js ~/.hub/modules/my-module/
```

或者使用符号链接：

```bash
ln -s /path/to/your/module ~/.hub/modules/my-module
```

### 4. 启动模块

```bash
# 列出所有模块
hub list

# 启动模块
hub start my-module

# 查看状态
hub status my-module

# 查看日志
hub logs my-module

# 停止模块
hub stop my-module
```

## 示例模块

查看 `examples/` 目录下的完整示例：

- **Node.js 示例**: `examples/nodejs-module/`
- **Python 示例**: `examples/python-module/`
- **Shell 示例**: `examples/shell-module/`

## 常见问题

### Q: 模块启动失败怎么办？

1. 检查日志：`hub logs my-module`
2. 确认脚本路径正确
3. 确认脚本有执行权限（Shell 脚本）
4. 确认依赖已安装（Node.js 的 node_modules，Python 的虚拟环境）

### Q: 如何让模块开机自启？

在 `module.json` 中设置 `"autoStart": true`，然后配置中控台开机自启：

```bash
# macOS
hub install-launcher

# Linux (systemd)
hub install-service
```

### Q: 如何传递环境变量？

在模块目录下创建 `.env` 文件：

```
API_KEY=your-api-key
PORT=3000
```

### Q: 如何配置日志？

日志自动保存到 `~/.hub/logs/<module-id>.log`。

如果需要自定义日志格式，在脚本中直接输出到 stdout/stderr 即可。

## 高级配置

### 依赖管理

如果模块依赖其他模块，在 `module.json` 中添加：

```json
{
  "dependencies": ["database", "redis"]
}
```

中控台会按依赖顺序启动模块。

### 健康检查

实现健康检查接口（可选）：

```javascript
// Node.js 示例
process.on('message', (msg) => {
  if (msg === 'health-check') {
    process.send({ status: 'healthy' });
  }
});
```

### 资源限制

在 `module.json` 中配置资源限制：

```json
{
  "resources": {
    "memory": "100MB",
    "cpu": "50%"
  }
}
```

## 下一步

- 阅读 [模块协议规范](./module-protocol.md) 了解详细接口定义
- 查看 [API 文档](./api.md) 了解编程接口
- 加入社区讨论：[GitHub Discussions](https://github.com/your-repo/discussions)
