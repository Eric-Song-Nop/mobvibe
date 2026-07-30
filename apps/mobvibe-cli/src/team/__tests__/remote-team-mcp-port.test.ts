import { describe, expect, test } from "bun:test";
import type { ErrorDetail } from "@mobvibe/shared";
import type { TeamToolIntent } from "../agent-team-store.js";
import {
	RemoteTeamMcpPort,
	type TeamRelayCall,
	type TeamRelayCaller,
} from "../remote-team-mcp-port.js";
import {
	TEAM_COMMAND_ENVELOPE_VERSION,
	type TeamCommandEnvelope,
	type TeamCommandExecution,
} from "../team-command-bus.js";
import { TeamMcpRouter } from "../team-mcp-router.js";
import type { RemoteTeamSessionBinding } from "../team-relay-store.js";
import { EXPECTED_TEAM_TOOL_NAMES } from "../team-tool-handlers.js";

const serverId = "remote-team-server";
const agentTeamId = "11111111-1111-4111-8111-111111111111";
const memberId = "22222222-2222-4222-8222-222222222222";
const leaderMachineId = "leader-machine";

class RelayStub implements TeamRelayCaller {
	readonly calls: TeamRelayCall[] = [];
	result: unknown;
	error?: Error;

	async call(input: TeamRelayCall): Promise<unknown> {
		this.calls.push(input);
		if (this.error) throw this.error;
		return this.result;
	}
}

describe("RemoteTeamMcpPort", () => {
	test("binds only from the worker's remote-session fact and fixes runtime role to member", () => {
		const binding = createStoredBinding({ lifecycle: "active" });
		const reads: string[] = [];
		const port = new RemoteTeamMcpPort({
			store: {
				getRemoteSessionBindingByServerId: (candidate) => {
					reads.push(candidate);
					return candidate === serverId ? binding : undefined;
				},
			},
			relay: new RelayStub(),
		});

		expect(
			port.resolveBinding({
				serverId,
				transport: "acp",
			}),
		).toEqual({
			serverId,
			transport: "acp",
			agentTeamId,
			memberId,
			role: "member",
			commandTarget: "leader_relay",
		});
		expect(reads).toEqual([serverId]);
		expect(() =>
			port.resolveBinding({
				serverId: `mobvibe-team:forged-team:forged-member`,
				transport: "acp",
			}),
		).toThrow("Remote Team MCP binding not found");
	});

	test("allows creating and active bindings but rejects failed and closed bindings", () => {
		for (const lifecycle of ["creating", "active"] as const) {
			const port = createPort({ lifecycle });
			expect(port.resolveBinding({ serverId, transport: "acp" }).memberId).toBe(
				memberId,
			);
		}

		for (const lifecycle of ["failed", "closed"] as const) {
			const port = createPort({ lifecycle });
			expect(() => port.resolveBinding({ serverId, transport: "acp" })).toThrow(
				"Remote Team MCP binding is not connectable",
			);
		}
	});

	test("relays the original command to the authoritative leader without role metadata", async () => {
		const relay = new RelayStub();
		const port = createPort({ relay });
		const binding = port.resolveBinding({ serverId, transport: "acp" });
		const command = createCommand();
		const execution = createExecution(command);
		relay.result = execution;

		await expect(port.dispatchCommand({ binding, command })).resolves.toBe(
			execution,
		);

		expect(relay.calls).toHaveLength(1);
		expect(relay.calls[0]).toEqual({
			operationId: command.operationId,
			operation: "team.command",
			targetMachineId: leaderMachineId,
			payload: command,
		});
		expect(relay.calls[0].payload).toBe(command);
		expect(relay.calls[0]).not.toHaveProperty("role");
		expect(relay.calls[0].payload).not.toHaveProperty("role");
	});

	test("rejects command identity spoofing before relay dispatch", async () => {
		const relay = new RelayStub();
		const port = createPort({ relay });
		const binding = port.resolveBinding({ serverId, transport: "acp" });

		await expect(
			port.dispatchCommand({
				binding,
				command: {
					...createCommand(),
					agentTeamId: "forged-team",
					callerMemberId: "forged-member",
				},
			}),
		).rejects.toThrow("Team command identity does not match remote binding");
		expect(relay.calls).toHaveLength(0);
	});

	test("propagates relay command failures unchanged", async () => {
		const relay = new RelayStub();
		const relayError = new Error("leader relay unavailable");
		relay.error = relayError;
		const port = createPort({ relay });
		const binding = port.resolveBinding({ serverId, transport: "acp" });

		await expect(
			port.dispatchCommand({ binding, command: createCommand() }),
		).rejects.toBe(relayError);
	});

	test("records lifecycle intent through member.runtime without local Team fact writes", async () => {
		const relay = new RelayStub();
		const reads: string[] = [];
		const storedBinding = createStoredBinding();
		const port = new RemoteTeamMcpPort({
			store: {
				getRemoteSessionBindingByServerId: (candidate) => {
					reads.push(candidate);
					return candidate === serverId ? storedBinding : undefined;
				},
			},
			relay,
		});
		const binding = port.resolveBinding({ serverId, transport: "acp" });
		const intent = createIntent();
		relay.result = intent;

		await expect(
			port.recordLifecycleIntent({
				binding,
				kind: "spawn_member",
				payload: { name: "Reviewer" },
				sourceRefs: [],
			}),
		).resolves.toBe(intent);

		expect(reads).toEqual([serverId]);
		expect(relay.calls).toHaveLength(1);
		expect(relay.calls[0]).toEqual({
			operationId: expect.any(String),
			operation: "member.runtime",
			targetMachineId: leaderMachineId,
			payload: {
				agentTeamId,
				memberId,
				kind: "spawn_member",
				payload: { name: "Reviewer" },
				sourceRefs: [],
			},
		});
		expect(relay.calls[0]).not.toHaveProperty("role");
		expect(relay.calls[0].payload).not.toHaveProperty("role");
	});

	test("keeps readiness volatile and resolves bootstrap waiters only at tools_ready", async () => {
		const port = createPort();
		const binding = port.resolveBinding({ serverId, transport: "acp" });
		let settled = false;
		const waiting = port.waitForReadiness(serverId).finally(() => {
			settled = true;
		});

		port.updateStatus({ binding, phase: "tools_waiting" });
		await Promise.resolve();
		expect(settled).toBe(false);
		expect(port.getReadiness(serverId)).toEqual({
			serverId,
			phase: "tools_waiting",
		});

		port.updateStatus({ binding, phase: "tools_ready" });
		await expect(waiting).resolves.toEqual({
			serverId,
			phase: "tools_ready",
		});
		await expect(port.waitForReadiness(serverId)).resolves.toEqual({
			serverId,
			phase: "tools_ready",
		});

		port.forgetReadiness(serverId);
		expect(port.getReadiness(serverId)).toBeUndefined();
	});

	test("does not regress ready state for duplicate connections and resets on final disconnect", () => {
		const reads: string[] = [];
		const storedBinding = createStoredBinding();
		const port = new RemoteTeamMcpPort({
			store: {
				getRemoteSessionBindingByServerId: (candidate) => {
					reads.push(candidate);
					return storedBinding;
				},
			},
			relay: new RelayStub(),
		});
		const router = new TeamMcpRouter({ port });

		router.handleConnect({ serverId });
		router.handleConnect({ serverId });
		router.handleListTools({
			serverId,
			toolNames: [...EXPECTED_TEAM_TOOL_NAMES],
		});
		router.handleDisconnect({ serverId });
		expect(port.getReadiness(serverId)?.phase).toBe("tools_ready");

		router.handleConnect({ serverId });
		expect(port.getReadiness(serverId)?.phase).toBe("tools_ready");
		router.handleDisconnect({ serverId });
		expect(port.getReadiness(serverId)?.phase).toBe("tools_ready");

		router.handleDisconnect({ serverId });
		expect(port.getReadiness(serverId)?.phase).toBe("not_started");
		expect(reads).toEqual([serverId]);
	});

	test("rejects bootstrap waiters on degraded tools and when readiness is forgotten", async () => {
		const port = createPort();
		const binding = port.resolveBinding({ serverId, transport: "acp" });
		const error: ErrorDetail = {
			code: "CAPABILITY_NOT_SUPPORTED",
			message: "Missing Team tools",
			retryable: true,
			scope: "session",
		};
		const degraded = port.waitForReadiness(serverId);

		port.updateStatus({ binding, phase: "degraded", lastError: error });

		await expect(degraded).rejects.toThrow("Missing Team tools");
		expect(port.getReadiness(serverId)).toEqual({
			serverId,
			phase: "degraded",
			lastError: error,
		});

		port.updateStatus({ binding, phase: "not_started" });
		const forgotten = port.waitForReadiness(serverId);
		port.forgetReadiness(serverId);
		await expect(forgotten).rejects.toThrow(
			"Remote Team MCP readiness forgotten",
		);
	});
});

function createPort(options?: {
	lifecycle?: RemoteTeamSessionBinding["lifecycle"];
	relay?: RelayStub;
}): RemoteTeamMcpPort {
	const storedBinding = createStoredBinding({
		lifecycle: options?.lifecycle,
	});
	return new RemoteTeamMcpPort({
		store: {
			getRemoteSessionBindingByServerId: (candidate) =>
				candidate === serverId ? storedBinding : undefined,
		},
		relay: options?.relay ?? new RelayStub(),
	});
}

function createStoredBinding(
	overrides: Partial<RemoteTeamSessionBinding> = {},
): RemoteTeamSessionBinding {
	return {
		serverId,
		agentTeamId,
		memberId,
		leaderMachineId,
		backendId: "backend-1",
		lifecycle: "active",
		createdAt: "2026-07-30T00:00:00.000Z",
		updatedAt: "2026-07-30T00:00:00.000Z",
		...overrides,
	};
}

function createCommand(): TeamCommandEnvelope {
	return {
		version: TEAM_COMMAND_ENVELOPE_VERSION,
		operationId: "command-operation",
		agentTeamId,
		callerMemberId: memberId,
		toolName: "mobvibe_team_members",
		args: { include: "all" },
	};
}

function createExecution(command: TeamCommandEnvelope): TeamCommandExecution {
	return {
		operationId: command.operationId,
		result: {
			caller: {
				agentTeamId,
				memberId,
				role: "member",
			},
			toolName: command.toolName,
			data: { source: "leader" },
		},
	};
}

function createIntent(): TeamToolIntent {
	return {
		intentId: "intent-1",
		agentTeamId,
		requestedByMemberId: memberId,
		kind: "spawn_member",
		payload: { name: "Reviewer" },
		status: "requested",
		sourceRefs: [],
		createdAt: "2026-07-30T00:00:00.000Z",
		updatedAt: "2026-07-30T00:00:00.000Z",
	};
}
