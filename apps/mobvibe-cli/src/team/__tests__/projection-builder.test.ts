import { describe, expect, test } from "bun:test";
import { buildAgentTeamSummary } from "../projection-builder.js";

const now = "2026-05-13T04:30:00.000Z";

const baseTeam = {
	agent_team_id: "team-1",
	machine_id: "machine-1",
	workspace_root_cwd: "/workspace/project",
	title: "Projection Team",
	lifecycle: "running",
	leader_member_id: "member-1",
	workspace_mode: "shared_workspace",
	created_at: now,
	updated_at: now,
	archived_at: null,
};

const baseMember = {
	member_id: "member-1",
	agent_team_id: "team-1",
	role: "leader",
	name: "Leader",
	backend_id: "backend-1",
	session_id: "session-1",
	lifecycle: "running",
	health: "healthy",
	worktree_source_cwd: null,
	worktree_branch: null,
	error_json: null,
	created_at: now,
	updated_at: now,
};

const baseMcpStatus = {
	agent_team_id: "team-1",
	member_id: "member-1",
	transport: "acp",
	server_id: null,
	phase: "tools_ready",
	last_error_json: null,
	updated_at: now,
};

describe("buildAgentTeamSummary mailbox projection", () => {
	test("projects mailbox counts and source refs without local body fields", () => {
		const mailboxRef = {
			type: "mailbox_message" as const,
			agentTeamId: "team-1",
			messageId: "message-1",
			fromMemberId: "member-1",
			toMemberId: "member-2",
			deliveredSessionId: "session-2",
		};
		const summary = buildAgentTeamSummary({
			team: baseTeam,
			members: [baseMember],
			mcpStatuses: [baseMcpStatus],
			mailboxMessages: [
				{
					message_id: "message-1",
					agent_team_id: "team-1",
					from_member_id: "member-1",
					to_member_id: "member-2",
					source_refs_json: JSON.stringify([mailboxRef]),
					read_at: null,
					wake_status: "failed",
					created_at: "2026-05-13T04:31:00.000Z",
					body_local_json: JSON.stringify({
						body: "local mailbox body",
						content: "local content",
					}),
				} as never,
				{
					message_id: "message-2",
					agent_team_id: "team-1",
					from_member_id: "member-2",
					to_member_id: "member-1",
					source_refs_json: null,
					read_at: now,
					wake_status: "sent",
					created_at: "2026-05-13T04:32:00.000Z",
				} as never,
			],
			tasks: [],
			summaryRefs: [],
		});

		expect(summary.mailboxCounts).toEqual({
			unread: 1,
			wakePending: 0,
			wakeFailed: 1,
			lastMailboxAt: "2026-05-13T04:32:00.000Z",
		});
		expect(summary.sourceRefs).toEqual([mailboxRef]);
		expect(summary.members[0].mailboxCounts.unread).toBe(1);
		expect(summary.members[0].sourceRefs).toEqual([mailboxRef]);

		const serialized = JSON.stringify(summary);
		expect(serialized).not.toContain("body_local_json");
		expect(serialized).not.toContain("local mailbox body");
		expect(serialized).not.toContain("local content");
		expect(serialized).not.toContain("body");
		expect(serialized).not.toContain("content");
		expect(serialized).not.toContain("description");
		expect(serialized).not.toContain("summaryText");
		expect(serialized).not.toContain("agentOutput");
	});
});
