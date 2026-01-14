import type {
	Implementation,
	NewSessionResponse,
	SessionModelState,
	SessionModeState,
} from "@agentclientprotocol/sdk";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "../src/acp/errors.js";
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
});
