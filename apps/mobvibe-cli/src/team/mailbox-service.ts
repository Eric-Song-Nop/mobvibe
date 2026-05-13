import { createErrorDetail, type ErrorDetail, type TeamSourceRef } from "@mobvibe/shared";
import type { AgentTeamStore } from "./agent-team-store.js";
import type { AgentTeamMemberRow } from "./projection-builder.js";
import type { TeamToolCaller } from "./team-tool-handlers.js";

export type MailboxSendArgs = {
	to: string;
	message: string;
	summary?: string;
};

export type MailboxDelivery = {
	messageId: string;
	fromMemberId: string;
	toMemberId: string;
	toName: string;
	wakeStatus: "pending";
	sourceRefs: TeamSourceRef[];
};

export type MailboxSendResult =
	| {
			ok: true;
			agentTeamId: string;
			deliveries: MailboxDelivery[];
	  }
	| {
			ok: false;
			error: ErrorDetail;
			deliveries: [];
	  };

export class MailboxService {
	constructor(private readonly store: AgentTeamStore) {}

	sendMessage(caller: TeamToolCaller, args: MailboxSendArgs): MailboxSendResult {
		const members = this.store.listTeamMembers(caller.agentTeamId);
		const recipients = this.resolveRecipients(members, caller, args.to);
		if (!recipients.ok) {
			return recipients;
		}

		const deliveries = this.store.createMailboxMessages({
			agentTeamId: caller.agentTeamId,
			fromMemberId: caller.memberId,
			recipients: recipients.members.map((member) => ({
				memberId: member.member_id,
				name: member.name,
			})),
			body: {
				message: args.message,
				summary: args.summary,
			},
		});

		return { ok: true, agentTeamId: caller.agentTeamId, deliveries };
	}

	private resolveRecipients(
		members: AgentTeamMemberRow[],
		caller: TeamToolCaller,
		to: string,
	):
		| { ok: true; members: AgentTeamMemberRow[] }
		| { ok: false; error: ErrorDetail; deliveries: [] } {
		const trimmed = to.trim();
		if (trimmed === "*") {
			return {
				ok: true,
				members: members.filter((member) => member.member_id !== caller.memberId),
			};
		}

		const normalized = normalizeName(trimmed);
		const member = members.find(
			(candidate) =>
				candidate.member_id === trimmed || normalizeName(candidate.name) === normalized,
		);

		if (!member) {
			return {
				ok: false,
				error: createErrorDetail({
					code: "REQUEST_VALIDATION_FAILED",
					message: `Unknown team mailbox recipient: ${trimmed}`,
					retryable: false,
					scope: "request",
				}),
				deliveries: [],
			};
		}

		return { ok: true, members: [member] };
	}
}

function normalizeName(value: string): string {
	return value.trim().replace(/\s+/g, " ").toLowerCase();
}
