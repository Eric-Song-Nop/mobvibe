import type { TeamSourceRef } from "@mobvibe/shared";
import type { AgentTeamStore, MailboxWakeMessage } from "./agent-team-store.js";
import { MailboxService } from "./mailbox-service.js";
import { TeamMcpRouter } from "./team-mcp-router.js";
import {
	TeamToolHandlers,
	type TeamToolHandlersOptions,
} from "./team-tool-handlers.js";

export type TeamRuntimeOptions = Omit<TeamToolHandlersOptions, "store"> & {
	store: AgentTeamStore;
	sessionManager?: TeamSessionInjector;
};

export type TeamSessionInjector = {
	injectTeamMailboxPrompt(input: {
		agentTeamId: string;
		memberId: string;
		sessionId: string;
		text: string;
	}): Promise<TeamSourceRef>;
};

export class TeamRuntime {
	readonly toolHandlers: TeamToolHandlers;
	readonly mcpRouter: TeamMcpRouter;
	private readonly store: AgentTeamStore;
	private readonly sessionManager?: TeamSessionInjector;
	private readonly mailboxService: MailboxService;

	constructor(options: TeamRuntimeOptions) {
		this.store = options.store;
		this.sessionManager = options.sessionManager;
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
			},
		});
		this.mcpRouter = new TeamMcpRouter({
			store: options.store,
			handlers: this.toolHandlers,
		});
	}

	async wakeMember(agentTeamId: string, memberId: string): Promise<void> {
		const member = this.store
			.listTeamMembers(agentTeamId)
			.find((candidate) => candidate.member_id === memberId);
		if (!member?.session_id || !this.sessionManager) {
			return;
		}
		const messages = this.store.readUnreadAndMark(agentTeamId, memberId);
		if (messages.length === 0) {
			return;
		}
		const promptText = buildMailboxPrompt(
			messages,
			this.store.listTeamMembers(agentTeamId),
		);
		try {
			const sessionRef = await this.sessionManager.injectTeamMailboxPrompt({
				agentTeamId,
				memberId,
				sessionId: member.session_id,
				text: promptText,
			});
			for (const message of messages) {
				this.store.updateWakeMetadata({
					messageId: message.messageId,
					wakeStatus: "sent",
					deliveredSessionId: member.session_id,
					sourceRefs: [sessionRef],
				});
			}
		} catch (error) {
			const safeError = toSafeWakeError(error);
			for (const message of messages) {
				this.store.updateWakeMetadata({
					messageId: message.messageId,
					wakeStatus: "failed",
					error: safeError,
				});
			}
		}
	}

	async onMemberTurnCompleted(
		agentTeamId: string,
		memberId: string,
	): Promise<void> {
		const members = this.store.listTeamMembers(agentTeamId);
		const member = members.find(
			(candidate) => candidate.member_id === memberId,
		);
		if (!member || member.role === "leader") {
			return;
		}
		const leader = members.find((candidate) => candidate.role === "leader");
		if (!leader) {
			return;
		}
		this.store.updateTeamMemberRuntimeState({
			agentTeamId,
			memberId,
			lifecycle: "completed",
		});
		this.store.createMailboxMessages({
			agentTeamId,
			fromMemberId: memberId,
			recipients: [{ memberId: leader.member_id, name: leader.name }],
			body: {
				message: "Turn completed",
				type: "idle_notification",
			},
		});
		if (this.areNonLeaderMembersSettled(agentTeamId)) {
			await this.wakeMember(agentTeamId, leader.member_id);
		}
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
