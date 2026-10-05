# 示例说明

本目录保留了早期 stdio / JSON 请求分发示例和试验模块。当前内置适配器直接托管进程，忽略 stdin，因此这些协议示例不能直接当作现行接入模板。

接入已有项目时，请使用 [快速开始](../docs/getting-started.md) 中的 `init-module`；运行和配置约定以 [模块接入与运行契约](../docs/module-protocol.md) 为准。无需给普通脚本增加 `status` / `start` / `stop` 的 JSON 请求接口。
