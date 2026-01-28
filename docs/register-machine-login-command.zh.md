* 设备注册命令调整方案

** 背景

当前设备注册对话框生成的登录命令包含 =--webui <url>=，但实际不需要指定 WebUI 地址，容易误导。

** 目标

- 注册命令仅展示 =mobvibe login=
- 文案不再强调指定 WebUI URL
- README 中 CLI 命令说明同步更新

** 实施步骤

1. 更新 WebUI 的注册对话框命令生成逻辑，移除 WebUI URL 拼接
2. 更新中英文 i18n 文案
3. 更新 README 英文/中文中的 CLI 命令列表

** 影响范围

- WebUI 注册设备弹窗
- i18n 文案
- README 文档

** 实施结果

- 注册命令改为 =mobvibe login=
- README 的 CLI 命令列表同步移除 =--webui <url>=

** 使用说明

- 在需要注册设备时，直接在目标机器执行 =mobvibe login=
