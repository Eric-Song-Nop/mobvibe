import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentTeamStore } from "../agent-team-store.js";
import { MailboxService } from "../mailbox-service.js";

type MailboxRow = {
	message_id: string;
	agent_team_id: string;
	from_member_id: string;
	to_member_id: string | null;
	body_local_json: string;
	source_refs_json: string | null;
	read_at: string | null;
	wake_status: string;
	created_at: string;
};

describe("MailboxService durable delivery", () => {
	let tempDir: string;
	let dbPath: string;
	let store: AgentTeamStore;
	let service: MailboxService;
	let agentTeamId: string;
	let leaderMemberId: string;
	let workerMemberId: string;
	let reviewerMemberId: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mailbox-service-"));
		dbPath = path.join(tempDir, "events.db");
		store = new AgentTeamStore(dbPath);
		service = new MailboxService(store);

		const created = store.createAgentTeam({
			machineId: "machine-1",
			workspaceRootCwd: "/workspace",
			backendId: "backend-1",
			title: "Mailbox Team",
			leaderName: "Leader",
		});
		agentTeamId = created.team.agentTeamId;
		leaderMemberId = created.team.leaderMemberId;
		workerMemberId = store.addTeamMember({
			agentTeamId,
			backendId: "backend-1",
			name: "Worker One",
			role: "member",
		}).memberId;
		reviewerMemberId = store.addTeamMember({
			agentTeamId,
			backendId: "backend-2",
			name: "Reviewer",
			role: "member",
		}).memberId;
	});

	afterEach(() => {
		store.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("direct message to memberId inserts a pending unread row with local body", () => {
		const result = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "hello worker", summary: "hello" },
		);

		expect(result.ok).toBe(true);
		const rows = readMailboxRows(dbPath);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toEqual(
			expect.objectContaining({
				agent_team_id: agentTeamId,
				from_member_id: leaderMemberId,
				to_member_id: workerMemberId,
				read_at: null,
				wake_status: "pending",
			}),
		);
		expect(JSON.parse(rows[0].body_local_json)).toEqual({
			message: "hello worker",
			summary: "hello",
		});
		expect(rows[0].created_at).toBeString();
	});

	test("recipient name resolves to memberId and output includes display name", () => {
		const result = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: "Worker One", message: "by name" },
		);

		expect(result).toEqual(
			expect.objectContaining({
				ok: true,
				deliveries: [
					expect.objectContaining({
						toMemberId: workerMemberId,
						toName: "Worker One",
					}),
				],
			}),
		);
		expect(readMailboxRows(dbPath)[0].to_member_id).toBe(workerMemberId);
	});

	test("broadcast inserts one row per current member except sender", () => {
		const result = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: "*", message: "team update" },
		);

		expect(result.ok).toBe(true);
		const rows = readMailboxRows(dbPath);
		expect(rows).toHaveLength(2);
		expect(rows.map((row) => row.to_member_id).sort()).toEqual(
			[reviewerMemberId, workerMemberId].sort(),
		);
		expect(rows.some((row) => row.to_member_id === leaderMemberId)).toBe(false);
	});

	test("successful deliveries persist metadata-only mailbox source refs", () => {
		service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "direct refs" },
		);
		service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: "Reviewer", message: "name refs" },
		);
		service.sendMessage(
			{ agentTeamId, memberId: workerMemberId, role: "member" },
			{ to: "*", message: "broadcast refs" },
		);

		const rows = readMailboxRows(dbPath);
		expect(rows).toHaveLength(4);
		for (const row of rows) {
			const refs = JSON.parse(row.source_refs_json ?? "[]") as Array<{
				type: string;
				agentTeamId: string;
				messageId: string;
				fromMemberId: string;
				toMemberId?: string;
			}>;
			expect(refs).toEqual([
				expect.objectContaining({
					type: "mailbox_message",
					agentTeamId,
					messageId: row.message_id,
					fromMemberId: row.from_member_id,
					toMemberId: row.to_member_id,
				}),
			]);
		}
	});

	test("invalid recipient returns structured error and creates no row", () => {
		const result = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: "Missing", message: "lost" },
		);

		expect(result).toEqual(
			expect.objectContaining({
				ok: false,
				deliveries: [],
				error: expect.objectContaining({
					code: "REQUEST_VALIDATION_FAILED",
					message: expect.stringContaining("Missing"),
				}),
			}),
		);
		expect(readMailboxRows(dbPath)).toHaveLength(0);
	});

	test("projection payload excludes message body while retaining source refs", () => {
		service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "secret mailbox text" },
		);

		const team = store.getAgentTeam({ agentTeamId }).team;
		const serialized = JSON.stringify(team);

		expect(serialized).not.toContain("secret mailbox text");
		expect(serialized).not.toContain("body_local_json");
		expect(serialized).not.toContain("body");
		expect(serialized).not.toContain("content");
		expect(serialized).not.toContain("description");
		expect(team?.sourceRefs?.[0]).toEqual(
			expect.objectContaining({
				type: "mailbox_message",
				agentTeamId,
				fromMemberId: leaderMemberId,
				toMemberId: workerMemberId,
			}),
		);
	});
});

function readMailboxRows(dbPath: string): MailboxRow[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.query("SELECT * FROM agent_team_mailbox_messages ORDER BY created_at ASC")
			.all() as MailboxRow[];
	} finally {
		db.close();
	}
}
