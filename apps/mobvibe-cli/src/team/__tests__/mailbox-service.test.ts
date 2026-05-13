import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentTeamStore } from "../agent-team-store.js";
import { MailboxService } from "../mailbox-service.js";
import { TeamRuntime } from "../team-runtime.js";

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

	test("readUnreadAndMark returns unread rows in creation order and marks exactly once", () => {
		const first = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "first unread" },
		);
		const otherRecipient = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: reviewerMemberId, message: "other recipient" },
		);
		const second = service.sendMessage(
			{ agentTeamId, memberId: reviewerMemberId, role: "member" },
			{ to: workerMemberId, message: "second unread" },
		);
		if (!first.ok || !second.ok || !otherRecipient.ok) {
			throw new Error("Expected setup delivery to succeed");
		}
		const alreadyReadId = first.deliveries[0].messageId;
		store.readUnreadAndMark(agentTeamId, workerMemberId);
		const third = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "third unread" },
		);
		if (!third.ok) {
			throw new Error("Expected third delivery to succeed");
		}

		const unread = store.readUnreadAndMark(agentTeamId, workerMemberId);

		expect(unread.map((message) => message.messageId)).toEqual([
			third.deliveries[0].messageId,
		]);
		expect(unread[0].body).toEqual({ message: "third unread" });
		const rows = readMailboxRows(dbPath);
		expect(rows.find((row) => row.message_id === alreadyReadId)?.read_at).toBeString();
		expect(
			rows.find((row) => row.message_id === third.deliveries[0].messageId)
				?.read_at,
		).toBeString();
		expect(
			rows.find(
				(row) => row.message_id === otherRecipient.deliveries[0].messageId,
			)?.read_at,
		).toBeNull();

		expect(store.readUnreadAndMark(agentTeamId, workerMemberId)).toEqual([]);
	});

	test("updateWakeMetadata preserves delivery refs and appends audit refs", () => {
		const sent = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "wake success" },
		);
		const failed = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: reviewerMemberId, message: "wake failure" },
		);
		if (!sent.ok || !failed.ok) {
			throw new Error("Expected setup delivery to succeed");
		}
		const sessionRef = {
			type: "session_event" as const,
			agentTeamId,
			memberId: workerMemberId,
			sessionId: "session-worker",
			revision: 1,
			seq: 3,
		};

		store.updateWakeMetadata({
			messageId: sent.deliveries[0].messageId,
			wakeStatus: "sent",
			deliveredSessionId: "session-worker",
			sourceRefs: [sessionRef],
		});
		store.updateWakeMetadata({
			messageId: failed.deliveries[0].messageId,
			wakeStatus: "failed",
			error: { code: "PROMPT_FAILED", message: "prompt failed" },
			sourceRefs: [
				{
					type: "mailbox_message",
					agentTeamId,
					messageId: failed.deliveries[0].messageId,
					fromMemberId: leaderMemberId,
					toMemberId: reviewerMemberId,
				},
			],
		});

		const rows = readMailboxRows(dbPath);
		const sentRow = rows.find(
			(row) => row.message_id === sent.deliveries[0].messageId,
		);
		const failedRow = rows.find(
			(row) => row.message_id === failed.deliveries[0].messageId,
		);
		expect(sentRow?.wake_status).toBe("sent");
		expect(failedRow?.wake_status).toBe("failed");
		expect(sentRow?.body_local_json).toContain("wake success");
		expect(failedRow?.body_local_json).toContain("wake failure");
		const sentRefs = JSON.parse(sentRow?.source_refs_json ?? "[]");
		const failedRefs = JSON.parse(failedRow?.source_refs_json ?? "[]");
		expect(sentRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "mailbox_message",
					deliveredSessionId: "session-worker",
				}),
				sessionRef,
			]),
		);
		expect(failedRefs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "mailbox_message",
					messageId: failed.deliveries[0].messageId,
				}),
			]),
		);
		expect(JSON.stringify(failedRefs)).not.toContain("deliveredSessionId");
	expect(readMailboxRows(dbPath)).toHaveLength(2);
	});

	test("runtime wake injects unread mailbox messages into attached ordinary session", async () => {
		setMemberState(dbPath, workerMemberId, {
			sessionId: "session-worker",
			lifecycle: "running",
		});
		const sent = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "please review", summary: "review" },
		);
		if (!sent.ok) {
			throw new Error("Expected setup delivery to succeed");
		}
		const injected: string[] = [];
		const runtime = new TeamRuntime({
			store,
			sessionManager: {
				injectTeamMailboxPrompt: async (input) => {
					injected.push(input.text);
					return {
						type: "session_event",
						agentTeamId: input.agentTeamId,
						memberId: input.memberId,
						sessionId: input.sessionId,
						revision: 1,
						seq: 7,
					};
				},
			},
		});

		await runtime.wakeMember(agentTeamId, workerMemberId);

		expect(injected).toHaveLength(1);
		expect(injected[0]).toContain("Mobvibe Agent Team mailbox delivery");
		expect(injected[0]).toContain("Leader");
		expect(injected[0]).toContain("please review");
		const [row] = readMailboxRows(dbPath);
		expect(row.read_at).toBeString();
		expect(row.wake_status).toBe("sent");
		const refs = JSON.parse(row.source_refs_json ?? "[]");
		expect(refs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "mailbox_message",
					deliveredSessionId: "session-worker",
				}),
				expect.objectContaining({
					type: "session_event",
					sessionId: "session-worker",
					seq: 7,
				}),
			]),
		);
		const projection = JSON.stringify(store.getAgentTeam({ agentTeamId }).team);
		expect(projection).not.toContain("please review");
	});

	test("runtime wake failure preserves accepted message without delivered ref", async () => {
		setMemberState(dbPath, workerMemberId, {
			sessionId: "session-worker",
			lifecycle: "running",
		});
		const sent = service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "still durable" },
		);
		if (!sent.ok) {
			throw new Error("Expected setup delivery to succeed");
		}
		const runtime = new TeamRuntime({
			store,
			sessionManager: {
				injectTeamMailboxPrompt: async () => {
					throw new Error("prompt unavailable");
				},
			},
		});

		await runtime.wakeMember(agentTeamId, workerMemberId);

		const [row] = readMailboxRows(dbPath);
		expect(row.body_local_json).toContain("still durable");
		expect(row.wake_status).toBe("failed");
		const refs = JSON.parse(row.source_refs_json ?? "[]");
		expect(refs).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "mailbox_message",
					messageId: sent.deliveries[0].messageId,
				}),
			]),
		);
		expect(JSON.stringify(refs)).not.toContain("deliveredSessionId");
	});

	test("member turn completion writes idle notification and wakes leader only when settled", async () => {
		setMemberState(dbPath, leaderMemberId, {
			sessionId: "session-leader",
			lifecycle: "running",
		});
		setMemberState(dbPath, workerMemberId, {
			sessionId: "session-worker",
			lifecycle: "running",
		});
		setMemberState(dbPath, reviewerMemberId, {
			sessionId: "session-reviewer",
			lifecycle: "running",
		});
		const injected: string[] = [];
		const runtime = new TeamRuntime({
			store,
			sessionManager: {
				injectTeamMailboxPrompt: async (input) => {
					injected.push(input.text);
					return {
						type: "session_event",
						agentTeamId: input.agentTeamId,
						memberId: input.memberId,
						sessionId: input.sessionId,
						revision: 1,
						seq: injected.length,
					};
				},
			},
		});

		await runtime.onMemberTurnCompleted(agentTeamId, workerMemberId);
		expect(readMailboxRows(dbPath)).toHaveLength(1);
		expect(injected).toHaveLength(0);

		await runtime.onMemberTurnCompleted(agentTeamId, reviewerMemberId);

		const rows = readMailboxRows(dbPath);
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.to_member_id === leaderMemberId)).toBe(true);
		expect(rows.every((row) => row.body_local_json.includes("idle_notification"))).toBe(true);
		expect(injected).toHaveLength(1);
		expect(injected[0]).toContain("Turn completed");
		const projection = JSON.stringify(store.getAgentTeam({ agentTeamId }).team);
		expect(projection).not.toContain("Turn completed");
		expect(projection).not.toContain("idle_notification");
	});
});

function readMailboxRows(dbPath: string): MailboxRow[] {
	const db = new Database(dbPath, { readonly: true });
	try {
		return db
			.query(
				"SELECT * FROM agent_team_mailbox_messages ORDER BY created_at ASC",
			)
			.all() as MailboxRow[];
	} finally {
		db.close();
	}
}

function setMemberState(
	dbPath: string,
	memberId: string,
	params: { sessionId: string; lifecycle: string },
): void {
	const db = new Database(dbPath);
	try {
		db.query(
			`UPDATE agent_team_members
			 SET session_id = $sessionId, lifecycle = $lifecycle, updated_at = $updatedAt
			 WHERE member_id = $memberId`,
		).run({
			$sessionId: params.sessionId,
			$lifecycle: params.lifecycle,
			$updatedAt: new Date().toISOString(),
			$memberId: memberId,
		});
	} finally {
		db.close();
	}
}
