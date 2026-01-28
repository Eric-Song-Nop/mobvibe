# 选择设备的主机路径与会话路由

## 实现前计划

### 目标
- `/fs/roots` 与 `/fs/entries` 基于当前选中的 `machineId` 返回对应 CLI 主机路径。
- 新建会话使用选中的 `machineId` 进行路由，避免路径与会话主机不一致。
- 未选择设备时，在 WebUI 提示“请先选择机器”，并阻止目录浏览与创建。

### 方案
1. WebUI 传递 `machineId`
   - `WorkingDirectoryPicker/WorkingDirectoryDialog` 接收 `machineId`。
   - `fetchFsRoots/fetchFsEntries` 增加 `machineId` 查询参数。
   - 创建会话请求携带 `machineId`。
   - 未选中设备时显示错误提示并禁用创建。

2. Gateway 路由转发到指定 CLI
   - `/fs/roots`、`/fs/entries` 校验 `machineId` 并转发至对应 CLI。
   - 新增 `hostfs` RPC：`rpc:hostfs:roots`、`rpc:hostfs:entries`。
   - 校验 `userId` 与 `machineId` 归属关系（若开启认证）。

3. CLI 侧实现主机文件系统 RPC
   - 返回 `homePath/roots` 与目录 `entries`。
   - 维持现有条目结构与排序逻辑。

### 验收
- 选中机器后，目录浏览展示该机器的路径。
- 创建会话路由到选中机器。
- 未选中机器时，页面提示并无法创建会话。

## 实现后记录

### WebUI
- 目录浏览相关 API 增加 `machineId` 参数并在请求中透传。
- 新建会话请求携带 `machineId`，未选中设备时提示错误并禁用创建。
- 目录浏览弹窗在未选中设备时提示“请先选择机器”。

### Gateway
- `/fs/roots` 与 `/fs/entries` 转为基于 `machineId` 转发至 CLI 的 hostfs RPC。
- 新建会话支持 `machineId` 路由到指定 CLI，并做用户归属校验。

### CLI
- 新增 `rpc:hostfs:roots` 与 `rpc:hostfs:entries`，返回主机 Home 与目录条目。
