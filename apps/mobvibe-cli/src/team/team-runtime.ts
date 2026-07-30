import { randomUUID } from "node:crypto";
import type { TeamSourceRef } from "@mobvibe/shared";
import { logger } from "../lib/logger.js";
import type { AgentTeamStore, MailboxWakeMessage } from "./agent-team-store.js";
import { MailboxService } from "./mailbox-service.js";
import { TeamCommandBus } from "./team-command-bus.js";
import {
	createLeaderLocalTeamMcpPort,
	TeamMcpRouter,
} from "./team-mcp-router.js";
import {
	type SpawnMemberResult,
	TeamToolHandlers,
	type TeamToolHandlersOptions,
} from "./team-tool-handlers.js";

const DEFAULT_PENDING_WAKE_SWEEP_INTERVAL_MS = 30_000;

export type TeamRuntimeOptions = Omit<TeamToolHandlersOptions, "store"> & {
	store: AgentTeamStore;
	sessionManager?: TeamSessionInjector;
	pendingWakeSweepIntervalMs?: number;
};

export type TeamSessionInjector = {
	injectTeamMailboxPrompt(input: {
		agentTeamId: string;
		memberId: string;
		sessionId: string;
		text: string;
	}): Promise<TeamSourceRef>;
	spawnAgentTeamMember?(input: {
		agentTeamId: string;
		requestedByMemberId: string;
		name?: string;
		backendId?: string;
	}): Promise<SpawnMemberResult>;
};

export class TeamRuntime {
	readonly toolHandlers: TeamToolHandlers;
	readonly commandBus: TeamCommandBus;
	readonly mcpRouter: TeamMcpRouter;
	private readonly store: AgentTeamStore;
	private readonly sessionManager?: TeamSessionInjector;
	private readonly mailboxService: MailboxService;
	private readonly onAgentTeamChanged?: TeamRuntimeOptions["onAgentTeamChanged"];
	private readonly memberWakeFlights = new Map<string, Promise<void>>();
	private pendingWakeSweepTimer?: ReturnType<typeof setInterval>;
	private lifecycleGeneration = 0;
	private stopped = false;

	constructor(options: TeamRuntimeOptions) {
		this.store = options.store;
		this.sessionManager = options.sessionManager;
		this.onAgentTeamChanged = options.onAgentTeamChanged;
		this.mailboxService = new MailboxService(options.store);
		this.toolHandlers = new TeamToolHandlers({
			store: options.store,
			requestPermission: options.requestPermission,
			onAgentTeamChanged: options.onAgentTeamChanged,
			services: {
				...options.services,
				sendMessage:
					options.services?.sendMessage ??
					((caller, args) => this.sendMessageAndWake(caller, args)),
				spawnMember:
					options.services?.spawnMember ??
					((caller, args) => this.spawnMember(caller, args)),
			},
		});
		this.commandBus = new TeamCommandBus({
			store: options.store,
			handlers: this.toolHandlers,
		});
		this.mcpRouter = new TeamMcpRouter({
			port: createLeaderLocalTeamMcpPort({
				store: options.store,
				handlers: this.toolHandlers,
				dispatcher: this.commandBus,
			}),
		});
		this.startPendingWakeSweep(
			options.pendingWakeSweepIntervalMs ??
				DEFAULT_PENDING_WAKE_SWEEP_INTERVAL_MS,
		);
	}

	wakeMember(agentTeamId: string, memberId: string): Promise<void> {
		if (this.stopped || this.store.isClosed() || !this.sessionManager) {
			return Promise.resolve();
		}
		const flightKey = JSON.stringify([agentTeamId, memberId]);
		const existing = this.memberWakeFlights.get(flightKey);
		if (existing) {
			return existing;
		}
		const generation = this.lifecycleGeneration;
		const flight = Promise.resolve()
			.then(() => this.drainMemberMailbox(agentTeamId, memberId, generation))
			.finally(() => {
				if (this.memberWakeFlights.get(flightKey) === flight) {
					this.memberWakeFlights.delete(flightKey);
				}
			});
		this.memberWakeFlights.set(flightKey, flight);
		return flight;
	}

	async onMemberTurnCompleted(
		agentTeamId: string,
		memberId: string,
		turnId: string = randomUUID(),
	): Promise<void> {
		const completion = this.store.applyTeamRuntimeTurnCompletion({
			turnId,
			agentTeamId,
			memberId,
		});
		if (completion.status === "ignored") {
			return;
		}
		this.emitCurrentTeam(agentTeamId);
		let shouldWakeLeader = false;
		try {
			shouldWakeLeader = this.areNonLeaderMembersSettled(agentTeamId);
		} catch (error) {
			this.logPostCommitFailure(
				error,
				"agent_team_runtime_settled_check_failed",
				agentTeamId,
				completion.leaderMemberId,
			);
		}
		if (shouldWakeLeader) {
			void this.wakeMember(agentTeamId, completion.leaderMemberId).catch(
				(error) => {
					this.logPostCommitFailure(
						error,
						"agent_team_member_wake_failed",
						agentTeamId,
						completion.leaderMemberId,
					);
				},
			);
		}
	}

	stop(): void {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.lifecycleGeneration += 1;
		if (this.pendingWakeSweepTimer) {
			clearInterval(this.pendingWakeSweepTimer);
			this.pendingWakeSweepTimer = undefined;
		}
		this.memberWakeFlights.clear();
	}

	private async sendMessageAndWake(
		caller: {
			agentTeamId: string;
			memberId: string;
			role: "leader" | "member";
		},
		args: { to: string; message: string; summary?: string },
	) {
		const result = this.mailboxService.sendMessage(caller, args);
		if (result.ok) {
			for (const delivery of result.deliveries) {
				await this.wakeMember(caller.agentTeamId, delivery.toMemberId);
			}
		}
		return result;
	}

	private async spawnMember(
		caller: {
			agentTeamId: string;
			memberId: string;
			role: "leader" | "member";
		},
		args: { name?: string; backendId?: string },
	): Promise<SpawnMemberResult> {
		if (!this.sessionManager?.spawnAgentTeamMember) {
			return {
				ok: false,
				error: {
					code: "INTERNAL_ERROR",
					message: "Team session manager is not available",
					retryable: true,
					scope: "session",
				},
			};
		}
		const result = await this.sessionManager.spawnAgentTeamMember({
			agentTeamId: caller.agentTeamId,
			requestedByMemberId: caller.memberId,
			name: args.name,
			backendId: args.backendId,
		});
		this.emitCurrentTeam(caller.agentTeamId);
		return result;
	}

	private emitCurrentTeam(agentTeamId: string): void {
		try {
			const team = this.store.getAgentTeam({ agentTeamId }).team;
			if (team) this.onAgentTeamChanged?.(team);
		} catch (error) {
			this.logPostCommitFailure(
				error,
				"agent_team_projection_listener_failed",
				agentTeamId,
			);
		}
	}

	private areNonLeaderMembersSettled(agentTeamId: string): boolean {
		const members = this.store
			.listTeamMembers(agentTeamId)
			.filter((member) => member.role !== "leader");
		return (
			members.length > 0 &&
			members.every(
				(member) =>
					!new Set(["starting", "creating_session", "running"]).has(
						member.lifecycle,
					),
			)
		);
	}

	private async drainMemberMailbox(
		agentTeamId: string,
		memberId: string,
		generation: number,
	): Promise<void> {
		while (this.isGenerationActive(generation)) {
			const member = this.store
				.listTeamMembers(agentTeamId)
				.find((candidate) => candidate.member_id === memberId);
			if (!member?.session_id || !this.sessionManager) {
				return;
			}
			const messages = this.store.listUnreadForWake(agentTeamId, memberId);
			if (messages.length === 0) {
				return;
			}
			const promptText = buildMailboxPrompt(
				messages,
				this.store.listTeamMembers(agentTeamId),
			);
			let sessionRef: TeamSourceRef;
			try {
				sessionRef = await this.sessionManager.injectTeamMailboxPrompt({
					agentTeamId,
					memberId,
					sessionId: member.session_id,
					text: promptText,
				});
			} catch (error) {
				if (!this.isGenerationActive(generation)) {
					return;
				}
				const safeError = toSafeWakeError(error);
				for (const message of messages) {
					this.store.updateWakeMetadata({
						messageId: message.messageId,
						wakeStatus: "failed",
						error: safeError,
					});
				}
				return;
			}
			if (!this.isGenerationActive(generation)) {
				return;
			}
			this.store.completeMailboxWake({
				messageIds: messages.map((message) => message.messageId),
				deliveredSessionId: member.session_id,
				sourceRefs: [sessionRef],
			});
		}
	}

	private startPendingWakeSweep(intervalMs: number): void {
		if (!this.sessionManager) {
			return;
		}
		const safeIntervalMs =
			Number.isFinite(intervalMs) && intervalMs > 0
				? Math.floor(intervalMs)
				: DEFAULT_PENDING_WAKE_SWEEP_INTERVAL_MS;
		const generation = this.lifecycleGeneration;
		queueMicrotask(() => {
			this.sweepPendingWakes(generation);
		});
		this.pendingWakeSweepTimer = setInterval(() => {
			this.sweepPendingWakes(generation);
		}, safeIntervalMs);
		this.pendingWakeSweepTimer.unref();
	}

	private sweepPendingWakes(generation: number): void {
		if (!this.isGenerationActive(generation)) {
			return;
		}
		let recipients: ReturnType<AgentTeamStore["listPendingWakeRecipients"]>;
		try {
			recipients = this.store.listPendingWakeRecipients();
		} catch (error) {
			if (this.isGenerationActive(generation)) {
				this.logPostCommitFailure(
					error,
					"agent_team_pending_wake_sweep_failed",
				);
			}
			return;
		}
		for (const recipient of recipients) {
			if (!this.isGenerationActive(generation)) {
				return;
			}
			void this.wakeMember(recipient.agentTeamId, recipient.memberId).catch(
				(error) => {
					this.logPostCommitFailure(
						error,
						"agent_team_pending_wake_failed",
						recipient.agentTeamId,
						recipient.memberId,
					);
				},
			);
		}
	}

	private isGenerationActive(generation: number): boolean {
		return (
			!this.stopped &&
			!this.store.isClosed() &&
			this.lifecycleGeneration === generation
		);
	}

	private logPostCommitFailure(
		error: unknown,
		event: string,
		agentTeamId?: string,
		memberId?: string,
	): void {
		logger.warn(
			{
				...(agentTeamId ? { agentTeamId } : {}),
				...(memberId ? { memberId } : {}),
				errorName: error instanceof Error ? error.name : "UnknownError",
			},
			event,
		);
	}
}

function buildMailboxPrompt(
	messages: MailboxWakeMessage[],
	members: Array<{ member_id: string; name: string }>,
): string {
	const names = new Map(
		members.map((member) => [member.member_id, member.name]),
	);
	const lines = messages.map((message) => {
		const senderName = names.get(message.fromMemberId) ?? message.fromMemberId;
		return `- From ${senderName} (${message.fromMemberId}): ${message.body.message}`;
	});
	return [
		"Mobvibe Agent Team mailbox delivery",
		"The following teammate messages were delivered to this ordinary ACP session for auditability.",
		...lines,
	].join("\n");
}

function toSafeWakeError(error: unknown): { code: string; message: string } {
	return {
		code: "PROMPT_FAILED",
		message:
			error instanceof Error ? error.message.slice(0, 200) : "Wake failed",
	};
}
