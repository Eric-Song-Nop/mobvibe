import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentTeamStore } from "../agent-team-store.js";
import { MailboxService } from "../mailbox-service.js";
import { TeamRuntime, type TeamRuntimeOptions } from "../team-runtime.js";

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
	let runtimes: TeamRuntime[];

	const createRuntime = (options: TeamRuntimeOptions): TeamRuntime => {
		const runtime = new TeamRuntime(options);
		runtimes.push(runtime);
		return runtime;
	};

	beforeEach(() => {
		runtimes = [];
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
		for (const runtime of runtimes) {
			runtime.stop();
		}
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
		expect(
			rows.find((row) => row.message_id === alreadyReadId)?.read_at,
		).toBeString();
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
		const runtime = createRuntime({
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
		const runtime = createRuntime({
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
		expect(row.read_at).toBeNull();
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

	test("stop fences an in-flight injection before the durable store closes", async () => {
		setMemberState(dbPath, workerMemberId, {
			sessionId: "session-worker",
			lifecycle: "running",
		});
		service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "survive shutdown" },
		);
		let observeInjection: (() => void) | undefined;
		const injectionObserved = new Promise<void>((resolve) => {
			observeInjection = resolve;
		});
		let releaseInjection: (() => void) | undefined;
		const injectionGate = new Promise<void>((resolve) => {
			releaseInjection = resolve;
		});
		const runtime = createRuntime({
			store,
			sessionManager: {
				injectTeamMailboxPrompt: async (input) => {
					observeInjection?.();
					await injectionGate;
					return {
						type: "session_event",
						agentTeamId: input.agentTeamId,
						memberId: input.memberId,
						sessionId: input.sessionId,
						revision: 1,
						seq: 1,
					};
				},
			},
		});

		const wake = runtime.wakeMember(agentTeamId, workerMemberId);
		await injectionObserved;
		expect(readMailboxRows(dbPath)).toEqual([
			expect.objectContaining({
				read_at: null,
				wake_status: "pending",
			}),
		]);

		runtime.stop();
		store.close();
		releaseInjection?.();

		await expect(wake).resolves.toBeUndefined();
		expect(readMailboxRows(dbPath)).toEqual([
			expect.objectContaining({
				read_at: null,
				wake_status: "pending",
			}),
		]);
	});

	test("periodic sweep recovers mail inserted after the startup sweep", async () => {
		setMemberState(dbPath, workerMemberId, {
			sessionId: "session-worker",
			lifecycle: "running",
		});
		let observeInjection: (() => void) | undefined;
		const injectionObserved = new Promise<void>((resolve) => {
			observeInjection = resolve;
		});
		const injected: string[] = [];
		const runtime = createRuntime({
			store,
			pendingWakeSweepIntervalMs: 5,
			sessionManager: {
				injectTeamMailboxPrompt: async (input) => {
					injected.push(input.text);
					observeInjection?.();
					return {
						type: "session_event",
						agentTeamId: input.agentTeamId,
						memberId: input.memberId,
						sessionId: input.sessionId,
						revision: 1,
						seq: 1,
					};
				},
			},
		});
		await Promise.resolve();

		service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "missed producer wake" },
		);

		const recovery = await Promise.race([
			injectionObserved.then(() => "injected" as const),
			new Promise<"timed_out">((resolve) => {
				setTimeout(() => resolve("timed_out"), 100);
			}),
		]);
		expect(recovery).toBe("injected");
		await runtime.wakeMember(agentTeamId, workerMemberId);
		expect(injected).toHaveLength(1);
		expect(injected[0]).toContain("missed producer wake");
		expect(readMailboxRows(dbPath)).toEqual([
			expect.objectContaining({
				read_at: expect.any(String),
				wake_status: "sent",
			}),
		]);
	});

	test("restart repairs and sweeps a legacy nonterminal wake without replaying its completed turn", async () => {
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
			lifecycle: "completed",
		});
		const failedRuntime = createRuntime({
			store,
			sessionManager: {
				injectTeamMailboxPrompt: async () => {
					throw new Error("leader ACP unavailable before restart");
				},
			},
		});

		await failedRuntime.onMemberTurnCompleted(
			agentTeamId,
			workerMemberId,
			"turn-completed-before-restart",
		);
		await failedRuntime.wakeMember(agentTeamId, leaderMemberId);
		expect(readMailboxRows(dbPath)).toEqual([
			expect.objectContaining({
				read_at: null,
				wake_status: "failed",
			}),
		]);
		const legacyDb = new Database(dbPath);
		try {
			legacyDb
				.query(`
					UPDATE agent_team_mailbox_messages
					SET read_at = $readAt
					WHERE wake_status = 'failed'
				`)
				.run({ $readAt: "2026-07-31T00:00:00.000Z" });
		} finally {
			legacyDb.close();
		}

		failedRuntime.stop();
		store.close();
		store = new AgentTeamStore(dbPath);
		let observeInjection: (() => void) | undefined;
		const injectionObserved = new Promise<void>((resolve) => {
			observeInjection = resolve;
		});
		const recoveredRuntime = createRuntime({
			store,
			sessionManager: {
				injectTeamMailboxPrompt: async (input) => {
					observeInjection?.();
					return {
						type: "session_event",
						agentTeamId: input.agentTeamId,
						memberId: input.memberId,
						sessionId: input.sessionId,
						revision: 1,
						seq: 1,
					};
				},
			},
		});

		const recovery = await Promise.race([
			injectionObserved.then(() => "injected" as const),
			new Promise<"timed_out">((resolve) => {
				setTimeout(() => resolve("timed_out"), 100);
			}),
		]);
		expect(recovery).toBe("injected");
		expect(readMailboxRows(dbPath)).toEqual([
			expect.objectContaining({
				read_at: expect.any(String),
				wake_status: "sent",
			}),
		]);
		recoveredRuntime.stop();
	});

	test("serializes overlapping wakes for the same member and drains new mail", async () => {
		setMemberState(dbPath, workerMemberId, {
			sessionId: "session-worker",
			lifecycle: "running",
		});
		service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "first" },
		);
		let releaseFirst: (() => void) | undefined;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let observeFirst: (() => void) | undefined;
		const firstObserved = new Promise<void>((resolve) => {
			observeFirst = resolve;
		});
		let activeInjections = 0;
		let maxActiveInjections = 0;
		const injected: string[] = [];
		const runtime = createRuntime({
			store,
			sessionManager: {
				injectTeamMailboxPrompt: async (input) => {
					activeInjections += 1;
					maxActiveInjections = Math.max(maxActiveInjections, activeInjections);
					injected.push(input.text);
					if (injected.length === 1) {
						observeFirst?.();
						await firstGate;
					}
					activeInjections -= 1;
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

		const firstWake = runtime.wakeMember(agentTeamId, workerMemberId);
		await firstObserved;
		service.sendMessage(
			{ agentTeamId, memberId: leaderMemberId, role: "leader" },
			{ to: workerMemberId, message: "second" },
		);
		const secondWake = runtime.wakeMember(agentTeamId, workerMemberId);
		await new Promise((resolve) => setTimeout(resolve, 0));
		const callsBeforeRelease = injected.length;
		const overlapBeforeRelease = maxActiveInjections;
		releaseFirst?.();
		await Promise.all([firstWake, secondWake]);

		expect(callsBeforeRelease).toBe(1);
		expect(overlapBeforeRelease).toBe(1);
		expect(maxActiveInjections).toBe(1);
		expect(injected).toHaveLength(2);
		expect(injected[0]).toContain("first");
		expect(injected[1]).toContain("second");
		expect(
			readMailboxRows(dbPath).every(
				(row) => row.read_at !== null && row.wake_status === "sent",
			),
		).toBe(true);
	});

	test("member turn completion is idempotent and wakes leader only when settled", async () => {
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
		const runtime = createRuntime({
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

		await Promise.all([
			runtime.onMemberTurnCompleted(
				agentTeamId,
				workerMemberId,
				"turn-worker-1",
			),
			runtime.onMemberTurnCompleted(
				agentTeamId,
				workerMemberId,
				"turn-worker-1",
			),
		]);
		expect(readMailboxRows(dbPath)).toHaveLength(1);
		expect(injected).toHaveLength(0);

		await runtime.onMemberTurnCompleted(
			agentTeamId,
			reviewerMemberId,
			"turn-reviewer-1",
		);

		const rows = readMailboxRows(dbPath);
		expect(rows).toHaveLength(2);
		expect(rows.every((row) => row.to_member_id === leaderMemberId)).toBe(true);
		expect(
			rows.every((row) => row.body_local_json.includes("idle_notification")),
		).toBe(true);
		expect(injected).toHaveLength(1);
		expect(injected[0]).toContain("Turn completed");
		const projection = JSON.stringify(store.getAgentTeam({ agentTeamId }).team);
		expect(projection).not.toContain("Turn completed");
		expect(projection).not.toContain("idle_notification");
	});

	test("member turn completion does not wait for the leader prompt", async () => {
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
			lifecycle: "completed",
		});
		const runtime = createRuntime({
			store,
			sessionManager: {
				injectTeamMailboxPrompt: () => new Promise<never>(() => {}),
			},
		});

		const outcome = await Promise.race([
			runtime
				.onMemberTurnCompleted(
					agentTeamId,
					workerMemberId,
					"turn-worker-no-wait",
				)
				.then(() => "completed" as const),
			new Promise<"timed_out">((resolve) => {
				setTimeout(() => resolve("timed_out"), 0);
			}),
		]);

		expect(outcome).toBe("completed");
		expect(
			store
				.getAgentTeam({ agentTeamId })
				.team?.members.find((member) => member.memberId === workerMemberId)
				?.lifecycle,
		).toBe("completed");
		expect(readMailboxRows(dbPath)).toHaveLength(1);
	});

	test("projection listener failure is isolated after the durable commit", async () => {
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
			lifecycle: "completed",
		});
		let observeInjection: (() => void) | undefined;
		const injectionObserved = new Promise<void>((resolve) => {
			observeInjection = resolve;
		});
		const runtime = createRuntime({
			store,
			onAgentTeamChanged: () => {
				throw new Error("projection listener unavailable");
			},
			sessionManager: {
				injectTeamMailboxPrompt: async (input) => {
					observeInjection?.();
					return {
						type: "session_event",
						agentTeamId: input.agentTeamId,
						memberId: input.memberId,
						sessionId: input.sessionId,
						revision: 1,
						seq: 1,
					};
				},
			},
		});

		await expect(
			runtime.onMemberTurnCompleted(
				agentTeamId,
				workerMemberId,
				"turn-projection-listener-failure",
			),
		).resolves.toBeUndefined();
		await expect(
			Promise.race([
				injectionObserved.then(() => "injected" as const),
				new Promise<"timed_out">((resolve) => {
					setTimeout(() => resolve("timed_out"), 100);
				}),
			]),
		).resolves.toBe("injected");
		expect(readMailboxRows(dbPath)).toEqual([
			expect.objectContaining({
				read_at: expect.any(String),
				wake_status: "sent",
			}),
		]);
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
