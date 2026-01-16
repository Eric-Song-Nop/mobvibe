import type {
	Implementation,
	NewSessionResponse,
	RequestPermissionRequest,
	RequestPermissionResponse,
	SessionModelState,
	SessionModeState,
} from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/acp/errors.js";
import type { PermissionResultPayload } from "../src/acp/session-manager.js";
import type { AcpBackendConfig } from "../src/config.js";

const sessionModels: SessionModelState = {
	currentModelId: "model-1",
	availableModels: [{ modelId: "model-1", name: "Model One" }],
};

const sessionModes: SessionModeState = {
	currentModeId: "mode-1",
	availableModes: [{ id: "mode-1", name: "Mode One" }],
};

const sessionResponse = {
	sessionId: "session-1",
	models: sessionModels,
	modes: sessionModes,
} as unknown as NewSessionResponse;

const agentInfo = {
	name: "mock-agent",
	title: "Mock Agent",
} as unknown as Implementation;

vi.mock("../src/acp/opencode.js", () => {
	return {
		AcpConnection: class {
			private options: {
				backend: { id: string; label: string };
				command: string;
				args: string[];
			};
			private permissionHandler?: (
				params: RequestPermissionRequest,
			) => Promise<RequestPermissionResponse>;
			cancel = vi.fn(async () => undefined);
			setSessionMode = vi.fn(async () => undefined);
			setSessionModel = vi.fn(async () => undefined);

			constructor(options: {
				backend: { id: string; label: string };
				command: string;
				args: string[];
			}) {
				this.options = options;
			}

			async connect() {}
			async createSession() {
				return sessionResponse;
			}
			getAgentInfo() {
				return agentInfo;
			}
			onSessionUpdate() {
				return () => {};
			}
			getStatus() {
				return {
					backendId: this.options.backend.id,
					backendLabel: this.options.backend.label,
					state: "ready",
					command: this.options.command,
					args: this.options.args,
					error: undefined,
					pid: 100,
				};
			}
			setPermissionHandler(
				handler: (
					params: RequestPermissionRequest,
				) => Promise<RequestPermissionResponse>,
			) {
				this.permissionHandler = handler;
			}
			triggerPermission(params: RequestPermissionRequest) {
				if (!this.permissionHandler) {
					throw new Error("permission handler not set");
				}
				return this.permissionHandler(params);
			}
			async disconnect() {}
		},
	};
});

const { SessionManager } = await import("../src/acp/session-manager.js");

const backend: AcpBackendConfig = {
	id: "opencode",
	label: "opencode",
	command: "opencode",
	args: ["acp"],
};

describe("SessionManager", () => {
	it("creates sessions and returns summary", async () => {
		const manager = new SessionManager({
			backends: [backend],
			defaultBackendId: "opencode",
			client: { name: "mobvibe", version: "0.0.0" },
		});

		const summary = await manager.createSession({ title: "测试对话" });

		expect(summary.sessionId).toBe("session-1");
		expect(summary.title).toBe("测试对话");
		expect(summary.backendId).toBe("opencode");
		expect(summary.state).toBe("ready");
		expect(summary.agentName).toBe("Mock Agent");
		expect(summary.modelName).toBe("Model One");
		expect(summary.modeName).toBe("Mode One");
		expect(manager.listSessions()).toHaveLength(1);
	});

	it("updates title and closes sessions", async () => {
		const manager = new SessionManager({
			backends: [backend],
			defaultBackendId: "opencode",
			client: { name: "mobvibe", version: "0.0.0" },
		});

		await manager.createSession({ title: "初始" });
		const updated = manager.updateTitle("session-1", "新的标题");
		expect(updated.title).toBe("新的标题");

		const closed = await manager.closeSession("session-1");
		expect(closed).toBe(true);
		expect(manager.listSessions()).toHaveLength(0);
		expect(await manager.closeSession("session-1")).toBe(false);
	});

	it("removes session even if disconnect fails", async () => {
		const manager = new SessionManager({
			backends: [backend],
			defaultBackendId: "opencode",
			client: { name: "mobvibe", version: "0.0.0" },
		});

		await manager.createSession({ title: "初始" });

		const record = manager.getSession("session-1");
		expect(record).toBeDefined();

		const connection = record?.connection as unknown as {
			disconnect: ReturnType<typeof vi.fn>;
		};
		connection.disconnect = vi.fn(async () => {
			throw new Error("disconnect failed");
		});

		const consoleSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const closed = await manager.closeSession("session-1");

		expect(closed).toBe(true);
		expect(manager.listSessions()).toHaveLength(0);
		expect(connection.disconnect).toHaveBeenCalled();
		expect(consoleSpy).toHaveBeenCalled();

		consoleSpy.mockRestore();
	});

	it("throws when updating a missing session", () => {
		const manager = new SessionManager({
			backends: [backend],
			defaultBackendId: "opencode",
			client: { name: "mobvibe", version: "0.0.0" },
		});

		try {
			manager.updateTitle("missing", "title");
			throw new Error("should not reach");
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			const appError = error as AppError;
			expect(appError.detail.code).toBe("SESSION_NOT_FOUND");
			return;
		}
	});

	it("cancels sessions and pending permissions", async () => {
		const manager = new SessionManager({
			backends: [backend],
			defaultBackendId: "opencode",
			client: { name: "mobvibe", version: "0.0.0" },
		});

		await manager.createSession({ title: "初始" });

		const results: PermissionResultPayload[] = [];
		manager.onPermissionResult((payload) => {
			results.push(payload);
		});

		const record = manager.getSession("session-1");
		expect(record).toBeDefined();

		const connection = record?.connection as unknown as {
			cancel: ReturnType<typeof vi.fn>;
			triggerPermission: (
				params: RequestPermissionRequest,
			) => Promise<RequestPermissionResponse>;
		};

		const permissionRequest: RequestPermissionRequest = {
			sessionId: "session-1",
			options: [
				{
					optionId: "allow",
					kind: "allow_once",
					name: "允许一次",
				},
			],
			toolCall: {
				toolCallId: "tool-1",
				title: "Mock Tool",
			},
		};

		const pending = connection.triggerPermission(permissionRequest);
		const cancelled = await manager.cancelSession("session-1");

		expect(cancelled).toBe(true);
		await expect(pending).resolves.toEqual({
			outcome: { outcome: "cancelled" },
		});
		expect(connection.cancel).toHaveBeenCalledWith("session-1");
		expect(results).toEqual([
			{
				sessionId: "session-1",
				requestId: "tool-1",
				outcome: { outcome: "cancelled" },
			},
		]);
		expect(manager.listPendingPermissions("session-1")).toHaveLength(0);
		expect(await manager.cancelSession("missing")).toBe(false);
	});

	it("updates session mode and model", async () => {
		const manager = new SessionManager({
			backends: [backend],
			defaultBackendId: "opencode",
			client: { name: "mobvibe", version: "0.0.0" },
		});

		await manager.createSession({ title: "初始" });

		const record = manager.getSession("session-1");
		expect(record).toBeDefined();

		const connection = record?.connection as unknown as {
			setSessionMode: ReturnType<typeof vi.fn>;
			setSessionModel: ReturnType<typeof vi.fn>;
		};

		const modeSummary = await manager.setSessionMode("session-1", "mode-1");
		expect(modeSummary.modeId).toBe("mode-1");
		expect(modeSummary.modeName).toBe("Mode One");
		expect(connection.setSessionMode).toHaveBeenCalledWith(
			"session-1",
			"mode-1",
		);

		const modelSummary = await manager.setSessionModel("session-1", "model-1");
		expect(modelSummary.modelId).toBe("model-1");
		expect(modelSummary.modelName).toBe("Model One");
		expect(connection.setSessionModel).toHaveBeenCalledWith(
			"session-1",
			"model-1",
		);
	});

	it("rejects mode/model when capability missing", async () => {
		const manager = new SessionManager({
			backends: [backend],
			defaultBackendId: "opencode",
			client: { name: "mobvibe", version: "0.0.0" },
		});

		await manager.createSession({ title: "初始" });

		const record = manager.getSession("session-1");
		expect(record).toBeDefined();
		if (!record) {
			return;
		}
		record.availableModes = undefined;
		record.availableModels = undefined;

		try {
			await manager.setSessionMode("session-1", "mode-1");
			throw new Error("should not reach");
		} catch (error) {
			const appError = error as AppError;
			expect(appError.detail.code).toBe("CAPABILITY_NOT_SUPPORTED");
		}

		try {
			await manager.setSessionModel("session-1", "model-1");
			throw new Error("should not reach");
		} catch (error) {
			const appError = error as AppError;
			expect(appError.detail.code).toBe("CAPABILITY_NOT_SUPPORTED");
		}
	});
});
