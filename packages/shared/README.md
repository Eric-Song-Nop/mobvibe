# @mobvibe/shared

Shared TypeScript types for the remote-claude monorepo.

## Installation

This package is used internally by the monorepo and is linked via pnpm workspace:

```json
{
  "dependencies": {
    "@mobvibe/shared": "workspace:*"
  }
}
```

## Usage

```typescript
import {
  // ACP types
  ContentBlock,
  SessionNotification,
  PermissionRequestPayload,
  PermissionDecisionPayload,

  // Socket.io event types
  CliToGatewayEvents,
  GatewayToCliEvents,
  WebuiToGatewayEvents,
  GatewayToWebuiEvents,

  // Session types
  SessionSummary,
  StopReason,

  // Error types
  ErrorDetail,
  ErrorCode,

  // File system types
  FsRoot,
  FsEntry,
  SessionFsFilePreview,
} from "@mobvibe/shared";
```

## Type Categories

### ACP Protocol Types (`types/acp.ts`)

Types aligned with the Agent Client Protocol:

- `ContentBlock` - Message content (text, images, etc.)
- `SessionNotification` - Session update events
- `PermissionRequestPayload` - Permission request data
- `PermissionDecisionPayload` - Permission decision outcome
- `PermissionToolCall` - Tool call info in permission requests
- `TerminalOutputEvent` - Terminal output streaming data

### Socket.io Event Types (`types/socket-events.ts`)

Type-safe event definitions for Socket.io communication:

- `CliToGatewayEvents` - Events from CLI to gateway
- `GatewayToCliEvents` - Events from gateway to CLI (RPC calls)
- `WebuiToGatewayEvents` - Events from webui to gateway
- `GatewayToWebuiEvents` - Events from gateway to webui
- `RpcRequest<T>` / `RpcResponse<T>` - RPC request/response wrappers

### Session Types (`types/session.ts`)

- `SessionSummary` - Session metadata for listing
- `SessionCreateParams` - Parameters for creating sessions
- `StopReason` - Why a session/message stopped

### Error Types (`types/errors.ts`)

- `ErrorDetail` - Structured error information
- `ErrorCode` - Standard error codes
- `StreamErrorPayload` - Error events in streams

### File System Types (`types/fs.ts`)

- `FsRoot` - File system root information
- `FsEntry` - Directory entry (file or folder)
- `SessionFsFilePreview` - File preview data
- `SessionFsResourceEntry` - Resource listing entry

## Building

```bash
pnpm build    # Compile TypeScript
pnpm dev      # Watch mode
```
