# 机器注册按用户隔离 machineId（方案A）实现计划

## 目标
- 同一物理机可被多个账号独立注册，不共享会话
- 不改数据库结构，保持旧数据兼容

## 核心思路
- 网关在 CLI 注册时将 raw machineId 归一为 user-scoped id
- 优先复用用户已有的旧机器记录（id=rawMachineId）
- 新注册使用 `${userId}:${rawMachineId}` 作为机器主键
- 所有对外事件/状态使用归一后的 machineId

## 变更范围
- gateway: `cli-handlers.ts`、`db-service.ts`
- docs: 增加实现说明文档

## 兼容策略
- 已有机器记录（id=rawMachineId）对原用户继续使用
- 未启用认证/无 userId 时保持原 machineId

## 风险与验证
- UI 机器列表与会话关联必须使用归一 id
- 验证同一 raw machineId 可被不同账号同时注册
