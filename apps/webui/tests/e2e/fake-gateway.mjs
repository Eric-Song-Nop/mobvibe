import { randomUUID } from "node:crypto";
import http from "node:http";
import {
	decryptPayload,
	deriveContentKeyPair,
	encryptPayload,
	generateDEK,
	initCrypto,
	isEncryptedPayload,
	uint8ToBase64,
	wrapDEK,
} from "@mobvibe/shared";
import { Server as SocketIOServer } from "socket.io";

const PORT = Number(process.env.PLAYWRIGHT_GATEWAY_PORT ?? "33005");
const MACHINE_ID = "machine-1";
const PRIMARY_MASTER_SECRET_BYTES = new Uint8Array(
	Array.from({ length: 32 }, (_, index) => index + 1),
);
const SECONDARY_MASTER_SECRET_BYTES = new Uint8Array(
	Array.from({ length: 32 }, (_, index) => index + 65),
);
await initCrypto();

const SECRET_RECORDS = {
	primary: {
		base64: uint8ToBase64(PRIMARY_MASTER_SECRET_BYTES),
		contentKeyPair: deriveContentKeyPair(PRIMARY_MASTER_SECRET_BYTES),
	},
	secondary: {
		base64: uint8ToBase64(SECONDARY_MASTER_SECRET_BYTES),
		contentKeyPair: deriveContentKeyPair(SECONDARY_MASTER_SECRET_BYTES),
	},
};

const MASTER_SECRET_BASE64 = SECRET_RECORDS.primary.base64;
const SECONDARY_MASTER_SECRET_BASE64 = SECRET_RECORDS.secondary.base64;
const E2E_USER = {
	id: "user-1",
	email: "e2e@mobvibe.test",
	name: "E2E User",
	image: null,
	emailVerified: true,
	createdAt: "2024-01-01T00:00:00.000Z",
	updatedAt: "2024-01-01T00:00:00.000Z",
};
const E2E_SESSION = {
	id: "session-token-1",
	userId: E2E_USER.id,
	token: "e2e-session-token",
	expiresAt: "2099-01-01T00:00:00.000Z",
	createdAt: "2024-01-01T00:00:00.000Z",
	updatedAt: "2024-01-01T00:00:00.000Z",
};

const getSecretRecord = (secretId = "primary") =>
	SECRET_RECORDS[secretId] ?? SECRET_RECORDS.primary;

const buildCorsHeaders = (req) => ({
	"access-control-allow-origin": req.headers.origin ?? "http://127.0.0.1:4173",
	"access-control-allow-credentials": "true",
});

const delay = (ms) =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

const json = (req, res, statusCode, payload) => {
	res.writeHead(statusCode, {
		"content-type": "application/json",
		...buildCorsHeaders(req),
	});
	res.end(JSON.stringify(payload));
};

const notFound = (req, res) => json(req, res, 404, { error: "not_found" });

const parseBody = async (req) => {
	const chunks = [];
	for await (const chunk of req) {
		chunks.push(chunk);
	}
	if (chunks.length === 0) {
		return {};
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const baseSession = (overrides = {}) => ({
	sessionId: "session-1",
	title: "Restore Session",
	backendId: "backend-1",
	backendLabel: "Claude",
	createdAt: "2024-01-01T00:00:00Z",
	updatedAt: "2024-01-01T00:00:00Z",
	machineId: MACHINE_ID,
	cwd: "/repo",
	revision: 1,
	isAttached: true,
	...overrides,
});

const buildTextPayload = ({ sessionId, text, kind }) => ({
	sessionId,
	update: {
		sessionUpdate:
			kind === "user_message" ? "user_message_chunk" : "agent_message_chunk",
		content: { type: "text", text },
	},
});

const buildEvent = ({
	sessionId = "session-1",
	revision = 1,
	seq = 1,
	kind = "agent_message_chunk",
	text = "event",
	payload,
	encrypted = false,
	sessionDeks = state.sessionDeks,
}) => {
	const eventPayload =
		payload ??
		(kind === "turn_end"
			? { stopReason: "end_turn" }
			: buildTextPayload({ sessionId, text, kind }));
	return {
		sessionId,
		machineId: MACHINE_ID,
		revision,
		seq,
		kind,
		createdAt: new Date().toISOString(),
		eventId: randomUUID(),
		payload:
			encrypted && sessionDeks.get(sessionId)
				? encryptPayload(eventPayload, sessionDeks.get(sessionId))
				: eventPayload,
	};
};

const createEncryptedSessionState = (
	sessionId,
	{ secretId = "primary", ...overrides } = {},
) => {
	const dek = generateDEK();
	const secret = getSecretRecord(secretId);
	return {
		dek,
		session: baseSession({
			sessionId,
			title: "Encrypted Revision Session",
			revision: 2,
			wrappedDek: wrapDEK(dek, secret.contentKeyPair.publicKey),
			...overrides,
		}),
	};
};

const buildMessageScript = ({
	assistantText = "Encrypted assistant reply",
	stopReason = "end_turn",
	delayMs = 0,
	statusCode = 200,
	body,
	encryptResponse = true,
} = {}) => ({
	assistantText,
	stopReason,
	delayMs,
	statusCode,
	body: body ?? { stopReason },
	encryptResponse,
});

const createScenarioState = ({
	sessions,
	events,
	loadResponses = [],
	reloadResponses = [],
	eventFetchScripts = [],
	sessionDeks = [],
	messageScripts = [],
}) => ({
	sessions,
	events: new Map(events),
	loadResponses: new Map(loadResponses),
	reloadResponses: new Map(reloadResponses),
	eventFetchScripts: new Map(eventFetchScripts),
	sessionDeks: new Map(sessionDeks),
	messageScripts: new Map(messageScripts),
	messageRequests: [],
});

const buildActionScript = (summary, overrides = {}) => ({
	summary,
	statusCode: 200,
	body: summary,
	delayMs: 0,
	...overrides,
});

const buildFailureScript = ({
	statusCode = 500,
	body = { error: "test_failure" },
	delayMs = 0,
}) => ({
	statusCode,
	body,
	delayMs,
});

const buildEventFetchScript = ({
	delayMs = 0,
	statusCode = 200,
	body,
} = {}) => ({
	delayMs,
	statusCode,
	body,
});

const normalizeActionScript = (value) => {
	if (!value) {
		return undefined;
	}
	if ("summary" in value || "statusCode" in value) {
		return value;
	}
	return buildActionScript(value);
};

const buildEventFetchKey = (sessionId, revision, afterSeq) =>
	`${sessionId}:${revision}:${afterSeq}`;

const findEventFetchScript = (sessionId, revision, afterSeq) =>
	state.eventFetchScripts.get(
		buildEventFetchKey(sessionId, revision, afterSeq),
	) ??
	state.eventFetchScripts.get(buildEventFetchKey(sessionId, revision, "*")) ??
	state.eventFetchScripts.get(buildEventFetchKey(sessionId, "*", "*"));

const respondWithActionScript = async (
	req,
	res,
	scriptValue,
	{ onSuccess, notFoundPayload } = {
		onSuccess: undefined,
		notFoundPayload: { error: "action_not_supported_for_test" },
	},
) => {
	const script = normalizeActionScript(scriptValue);
	if (!script) {
		json(req, res, 404, notFoundPayload);
		return;
	}
	if (script.delayMs > 0) {
		await delay(script.delayMs);
	}
	if (script.statusCode >= 400) {
		json(req, res, script.statusCode, script.body);
		return;
	}
	onSuccess?.(script.summary);
	json(req, res, script.statusCode, script.body);
};

const scenarios = {
	"refresh-restore": () =>
		createScenarioState({
			sessions: [baseSession({ title: "Restore Session", revision: 2 })],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 2,
							seq: 1,
							text: "Recovered after refresh",
							sessionDeks: new Map(),
						}),
					],
				],
			],
		}),
	"reconnect-gap": () =>
		createScenarioState({
			sessions: [baseSession({ title: "Reconnect Session", revision: 1 })],
			events: [["session-1", []]],
		}),
	"encrypted-revision": () => {
		const encrypted = createEncryptedSessionState("session-1");
		return createScenarioState({
			sessions: [encrypted.session],
			events: [["session-1", []]],
			sessionDeks: [["session-1", encrypted.dek]],
		});
	},
	"encrypted-buffered": () => {
		const encrypted = createEncryptedSessionState("session-1", {
			title: "Encrypted Buffer Session",
			revision: 1,
		});
		const sessionDeks = new Map([["session-1", encrypted.dek]]);
		return createScenarioState({
			sessions: [encrypted.session],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Buffered history line",
							encrypted: true,
							sessionDeks,
						}),
					],
				],
			],
			sessionDeks: [["session-1", encrypted.dek]],
		});
	},
	"encrypted-secondary-key": () => {
		const encrypted = createEncryptedSessionState("session-1", {
			title: "Secondary Key Session",
			revision: 1,
			secretId: "secondary",
		});
		const sessionDeks = new Map([["session-1", encrypted.dek]]);
		return createScenarioState({
			sessions: [encrypted.session],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Secondary key history line",
							encrypted: true,
							sessionDeks,
						}),
					],
				],
			],
			sessionDeks: [["session-1", encrypted.dek]],
		});
	},
	"encrypted-send": () => {
		const encrypted = createEncryptedSessionState("session-1", {
			title: "Encrypted Send Session",
			revision: 1,
		});
		return createScenarioState({
			sessions: [encrypted.session],
			events: [["session-1", []]],
			sessionDeks: [["session-1", encrypted.dek]],
			messageScripts: [
				[
					"session-1",
					buildMessageScript({
						assistantText: "Encrypted assistant reply",
					}),
				],
			],
		});
	},
	"sync-history": () =>
		createScenarioState({
			sessions: [baseSession({ title: "Sync Session", revision: 1 })],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Synced alpha line",
							sessionDeks: new Map(),
						}),
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 2,
							text: "Synced omega line",
							sessionDeks: new Map(),
						}),
					],
				],
			],
		}),
	"sync-history-interleaved": () =>
		createScenarioState({
			sessions: [baseSession({ title: "Sync Session", revision: 1 })],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Interleaved alpha line",
							sessionDeks: new Map(),
						}),
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 2,
							text: "Interleaved beta line",
							sessionDeks: new Map(),
						}),
					],
				],
			],
			eventFetchScripts: [
				[
					buildEventFetchKey("session-1", 1, "*"),
					buildEventFetchScript({ delayMs: 250 }),
				],
			],
		}),
	"force-reload": () =>
		createScenarioState({
			sessions: [baseSession({ title: "Reload Session", revision: 1 })],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Old revision transcript",
							sessionDeks: new Map(),
						}),
						buildEvent({
							sessionId: "session-1",
							revision: 2,
							seq: 1,
							text: "Reloaded alpha line",
							sessionDeks: new Map(),
						}),
						buildEvent({
							sessionId: "session-1",
							revision: 2,
							seq: 2,
							text: "Reloaded omega line",
							sessionDeks: new Map(),
						}),
					],
				],
			],
			reloadResponses: [
				[
					"session-1",
					buildActionScript(
						baseSession({
							title: "Reload Session",
							revision: 2,
							isAttached: true,
						}),
					),
				],
			],
		}),
	"force-reload-failure": () =>
		createScenarioState({
			sessions: [baseSession({ title: "Reload Failure Session", revision: 1 })],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Reload failure baseline",
							sessionDeks: new Map(),
						}),
					],
				],
			],
			reloadResponses: [
				[
					"session-1",
					buildFailureScript({
						statusCode: 500,
						body: { error: "reload_failed_for_test" },
					}),
				],
			],
		}),
	"sidebar-load": () =>
		createScenarioState({
			sessions: [
				baseSession({
					sessionId: "session-1",
					title: "Session Alpha",
					revision: 1,
					isAttached: true,
				}),
				baseSession({
					sessionId: "session-2",
					title: "Session Beta",
					revision: 1,
					isAttached: false,
				}),
			],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Alpha final transcript",
							sessionDeks: new Map(),
						}),
					],
				],
				[
					"session-2",
					[
						buildEvent({
							sessionId: "session-2",
							revision: 1,
							seq: 1,
							text: "Beta first line",
							sessionDeks: new Map(),
						}),
						buildEvent({
							sessionId: "session-2",
							revision: 1,
							seq: 2,
							text: "Beta second line",
							sessionDeks: new Map(),
						}),
					],
				],
			],
			loadResponses: [
				[
					"session-2",
					buildActionScript(
						baseSession({
							sessionId: "session-2",
							title: "Session Beta",
							revision: 1,
							isAttached: true,
						}),
					),
				],
			],
		}),
	"sidebar-load-failure": () =>
		createScenarioState({
			sessions: [
				baseSession({
					sessionId: "session-1",
					title: "Session Alpha",
					revision: 1,
					isAttached: true,
				}),
				baseSession({
					sessionId: "session-2",
					title: "Session Beta",
					revision: 1,
					isAttached: false,
				}),
			],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Alpha survives load failure",
							sessionDeks: new Map(),
						}),
					],
				],
				[
					"session-2",
					[
						buildEvent({
							sessionId: "session-2",
							revision: 1,
							seq: 1,
							text: "Beta should never appear",
							sessionDeks: new Map(),
						}),
					],
				],
			],
			loadResponses: [
				[
					"session-2",
					buildFailureScript({
						statusCode: 500,
						body: { error: "load_failed_for_test" },
					}),
				],
			],
		}),
	"sidebar-load-race": () =>
		createScenarioState({
			sessions: [
				baseSession({
					sessionId: "session-1",
					title: "Session Alpha",
					revision: 1,
					isAttached: true,
				}),
				baseSession({
					sessionId: "session-2",
					title: "Session Beta",
					revision: 1,
					isAttached: false,
				}),
				baseSession({
					sessionId: "session-3",
					title: "Session Gamma",
					revision: 1,
					isAttached: true,
				}),
			],
			events: [
				[
					"session-1",
					[
						buildEvent({
							sessionId: "session-1",
							revision: 1,
							seq: 1,
							text: "Alpha baseline transcript",
							sessionDeks: new Map(),
						}),
					],
				],
				[
					"session-2",
					[
						buildEvent({
							sessionId: "session-2",
							revision: 1,
							seq: 1,
							text: "Beta delayed transcript",
							sessionDeks: new Map(),
						}),
					],
				],
				[
					"session-3",
					[
						buildEvent({
							sessionId: "session-3",
							revision: 1,
							seq: 1,
							text: "Gamma final transcript",
							sessionDeks: new Map(),
						}),
					],
				],
			],
			loadResponses: [
				[
					"session-2",
					buildActionScript(
						baseSession({
							sessionId: "session-2",
							title: "Session Beta",
							revision: 1,
							isAttached: true,
						}),
						{ delayMs: 300 },
					),
				],
			],
		}),
};

let state = scenarios["refresh-restore"]();

const appendEvent = (event) => {
	const existing = state.events.get(event.sessionId) ?? [];
	existing.push(event);
	state.events.set(event.sessionId, existing);
};

const nextSeqForSession = (sessionId, revision) => {
	const events = state.events.get(sessionId) ?? [];
	return (
		events
			.filter((event) => event.revision === revision)
			.reduce((maxSeq, event) => Math.max(maxSeq, event.seq), 0) + 1
	);
};

const decodePrompt = (sessionId, prompt) => {
	if (!isEncryptedPayload(prompt)) {
		return null;
	}
	const dek = state.sessionDeks.get(sessionId);
	if (!dek) {
		return null;
	}
	try {
		return decryptPayload(prompt, dek);
	} catch {
		return null;
	}
};

const upsertSession = (summary) => {
	const index = state.sessions.findIndex(
		(session) => session.sessionId === summary.sessionId,
	);
	if (index === -1) {
		state.sessions.push(summary);
		return;
	}
	state.sessions[index] = {
		...state.sessions[index],
		...summary,
	};
};

const emitSessionAttached = (sessionId, revision) => {
	io.of("/webui").emit("session:attached", {
		sessionId,
		machineId: MACHINE_ID,
		attachedAt: new Date().toISOString(),
		revision,
	});
};

const server = http.createServer(async (req, res) => {
	if (!req.url) {
		notFound(req, res);
		return;
	}

	if (req.method === "OPTIONS") {
		res.writeHead(204, {
			...buildCorsHeaders(req),
			"access-control-allow-methods": "GET,POST,OPTIONS",
			"access-control-allow-headers": "content-type",
		});
		res.end();
		return;
	}

	const url = new URL(req.url, `http://127.0.0.1:${PORT}`);

	if (req.method === "GET" && url.pathname === "/acp/backends") {
		json(req, res, 200, {
			backends: [{ backendId: "backend-1", backendLabel: "Claude" }],
		});
		return;
	}

	if (req.method === "GET" && url.pathname === "/acp/sessions") {
		json(req, res, 200, { sessions: state.sessions });
		return;
	}

	if (req.method === "GET" && url.pathname === "/api/auth/get-session") {
		json(req, res, 200, {
			user: E2E_USER,
			session: E2E_SESSION,
		});
		return;
	}

	if (req.method === "GET" && url.pathname === "/api/machines") {
		json(req, res, 200, {
			machines: [
				{
					id: MACHINE_ID,
					hostname: "fake-gateway",
					isOnline: true,
				},
			],
		});
		return;
	}

	if (req.method === "GET" && url.pathname === "/acp/session/events") {
		const sessionId = url.searchParams.get("sessionId");
		const revision = Number(url.searchParams.get("revision"));
		const afterSeq = Number(url.searchParams.get("afterSeq") ?? "0");
		const limit = Number(url.searchParams.get("limit") ?? "100");
		const session = state.sessions.find((item) => item.sessionId === sessionId);
		if (!sessionId || !session) {
			json(req, res, 404, { error: "session_not_found" });
			return;
		}

		if (revision !== session.revision) {
			json(req, res, 200, {
				sessionId,
				machineId: MACHINE_ID,
				revision: session.revision,
				events: [],
				hasMore: false,
			});
			return;
		}

		const fetchScript = findEventFetchScript(sessionId, revision, afterSeq);
		if (fetchScript?.delayMs > 0) {
			await delay(fetchScript.delayMs);
		}
		if (fetchScript && fetchScript.statusCode >= 400) {
			json(
				req,
				res,
				fetchScript.statusCode,
				fetchScript.body ?? {
					error: "event_fetch_failed_for_test",
				},
			);
			return;
		}

		const allEvents = state.events.get(sessionId) ?? [];
		const matching = allEvents.filter(
			(event) => event.revision === revision && event.seq > afterSeq,
		);
		const events = matching.slice(0, limit);
		json(req, res, 200, {
			sessionId,
			machineId: MACHINE_ID,
			revision,
			events,
			nextAfterSeq: events.at(-1)?.seq,
			hasMore: matching.length > events.length,
		});
		return;
	}

	if (req.method === "POST" && url.pathname === "/acp/session/load") {
		const body = await parseBody(req);
		await respondWithActionScript(
			req,
			res,
			state.loadResponses.get(body.sessionId),
			{
				notFoundPayload: { error: "load_not_supported_for_test" },
				onSuccess: (summary) => {
					upsertSession(summary);
					emitSessionAttached(summary.sessionId, summary.revision);
				},
			},
		);
		return;
	}

	if (req.method === "POST" && url.pathname === "/acp/session/reload") {
		const body = await parseBody(req);
		await respondWithActionScript(
			req,
			res,
			state.reloadResponses.get(body.sessionId),
			{
				notFoundPayload: { error: "reload_not_supported_for_test" },
				onSuccess: (summary) => {
					upsertSession(summary);
				},
			},
		);
		return;
	}

	if (req.method === "POST" && url.pathname === "/acp/session/cancel") {
		json(req, res, 200, { ok: true });
		return;
	}

	if (req.method === "POST" && url.pathname === "/acp/message") {
		const body = await parseBody(req);
		const { sessionId, prompt } = body ?? {};
		const session = state.sessions.find((item) => item.sessionId === sessionId);
		if (!sessionId || !session || !isEncryptedPayload(prompt)) {
			json(req, res, 400, { error: "sessionId and encrypted prompt required" });
			return;
		}

		const decryptedPrompt = decodePrompt(sessionId, prompt);
		state.messageRequests.push({
			sessionId,
			prompt,
			decryptedPrompt,
		});

		const script = state.messageScripts.get(sessionId);
		if (script?.delayMs > 0) {
			await delay(script.delayMs);
		}
		if (script?.statusCode && script.statusCode >= 400) {
			json(req, res, script.statusCode, script.body);
			return;
		}

		if (script?.assistantText) {
			const assistantEvent = buildEvent({
				sessionId,
				revision: session.revision,
				seq: nextSeqForSession(sessionId, session.revision),
				text: script.assistantText,
				encrypted: script.encryptResponse,
			});
			appendEvent(assistantEvent);
			io.of("/webui").to(sessionId).emit("session:event", assistantEvent);

			const turnEndEvent = buildEvent({
				sessionId,
				revision: session.revision,
				seq: nextSeqForSession(sessionId, session.revision),
				kind: "turn_end",
				payload: { stopReason: script.stopReason },
				encrypted: false,
			});
			appendEvent(turnEndEvent);
			io.of("/webui").to(sessionId).emit("session:event", turnEndEvent);
		}

		json(req, res, 200, script?.body ?? { stopReason: "end_turn" });
		return;
	}

	if (req.method === "POST" && url.pathname === "/__test__/reset") {
		const body = await parseBody(req);
		const scenarioName = body.scenario;
		if (!scenarioName || !(scenarioName in scenarios)) {
			json(req, res, 400, { error: "unknown_scenario" });
			return;
		}
		state = scenarios[scenarioName]();
		json(req, res, 200, {
			ok: true,
			masterSecret: MASTER_SECRET_BASE64,
			secrets: {
				primary: MASTER_SECRET_BASE64,
				secondary: SECONDARY_MASTER_SECRET_BASE64,
			},
			sessions: state.sessions,
		});
		return;
	}

	if (req.method === "GET" && url.pathname === "/__test__/messages") {
		json(req, res, 200, {
			messages: state.messageRequests,
		});
		return;
	}

	if (req.method === "POST" && url.pathname === "/__test__/clear-messages") {
		state.messageRequests = [];
		json(req, res, 200, { ok: true });
		return;
	}

	if (req.method === "POST" && url.pathname === "/__test__/append-event") {
		const body = await parseBody(req);
		const event = buildEvent(body);
		appendEvent(event);
		json(req, res, 200, { ok: true, event });
		return;
	}

	if (req.method === "POST" && url.pathname === "/__test__/emit-event") {
		const body = await parseBody(req);
		const event = buildEvent(body);
		appendEvent(event);
		io.of("/webui").to(event.sessionId).emit("session:event", event);
		json(req, res, 200, { ok: true, event });
		return;
	}

	if (req.method === "POST" && url.pathname === "/__test__/disconnect") {
		for (const socket of io.of("/webui").sockets.values()) {
			socket.conn?.close();
		}
		json(req, res, 200, { ok: true });
		return;
	}

	notFound(req, res);
});

const io = new SocketIOServer(server, {
	path: "/socket.io",
	cors: {
		origin: "*",
		credentials: true,
	},
});

io.of("/webui").on("connection", (socket) => {
	socket.on("subscribe:session", ({ sessionId }) => {
		socket.join(sessionId);
	});
	socket.on("unsubscribe:session", ({ sessionId }) => {
		socket.leave(sessionId);
	});
	socket.on("disconnect", () => {});
});

server.listen(PORT, "127.0.0.1", () => {
	console.log(`fake gateway listening on ${PORT}`);
});
