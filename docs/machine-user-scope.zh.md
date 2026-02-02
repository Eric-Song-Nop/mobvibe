# 机器注册按用户隔离 machineId（方案A）

## 变更概述
- CLI 注册时由网关归一 machineId，避免不同账号之间发生冲突
- 会话相关事件统一使用归一后的 machineId

## 归一规则
- 若数据库已存在该用户的旧记录（id=rawMachineId），继续复用 rawMachineId
- 否则使用 `${userId}:${rawMachineId}` 作为机器主键
- 未启用认证/无 userId 时保持原 machineId

## 行为影响
- 同一台物理机可以被多个账号独立注册，但不会共享会话
- 旧数据保持不变，不需要迁移

## 相关实现
- `apps/gateway/src/services/db-service.ts`
- `apps/gateway/src/socket/cli-handlers.ts`
