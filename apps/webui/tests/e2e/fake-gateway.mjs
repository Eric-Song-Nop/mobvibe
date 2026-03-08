import { randomUUID } from "node:crypto";
import http from "node:http";
import {
	deriveContentKeyPair,
	encryptPayload,
	generateDEK,
	initCrypto,
	uint8ToBase64,
	wrapDEK,
} from "@mobvibe/shared";
import { Server as SocketIOServer } from "socket.io";

const PORT = 3005;
const MACHINE_ID = "machine-1";
const MASTER_SECRET_BYTES = new Uint8Array(
	Array.from({ length: 32 }, (_, index) => index + 1),
);
const MASTER_SECRET_BASE64 = uint8ToBase64(MASTER_SECRET_BYTES);
await initCrypto();
const CONTENT_KEY_PAIR = deriveContentKeyPair(MASTER_SECRET_BYTES);

const buildCorsHeaders = (req) => ({
	"access-control-allow-origin": req.headers.origin ?? "http://127.0.0.1:4173",
	"access-control-allow-credentials": "true",
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

const createEncryptedSessionState = (sessionId, overrides = {}) => {
	const dek = generateDEK();
	return {
		dek,
		session: baseSession({
			sessionId,
			title: "Encrypted Revision Session",
			revision: 2,
			wrappedDek: wrapDEK(dek, CONTENT_KEY_PAIR.publicKey),
			...overrides,
		}),
	};
};

const scenarios = {
	"refresh-restore": () => ({
		sessions: [baseSession({ title: "Restore Session", revision: 2 })],
		sessionDeks: new Map(),
		events: new Map([
			[
				"session-1",
				[
					{
						sessionId: "session-1",
						machineId: MACHINE_ID,
						revision: 2,
						seq: 1,
						kind: "agent_message_chunk",
						createdAt: "2024-01-01T00:00:00Z",
						payload: {
							sessionId: "session-1",
							update: {
								sessionUpdate: "agent_message_chunk",
								content: { type: "text", text: "Recovered after refresh" },
							},
						},
					},
				],
			],
		]),
	}),
	"reconnect-gap": () => ({
		sessions: [baseSession({ title: "Reconnect Session", revision: 1 })],
		sessionDeks: new Map(),
		events: new Map([["session-1", []]]),
	}),
	"encrypted-revision": () => {
		const encrypted = createEncryptedSessionState("session-1");
		return {
			sessions: [encrypted.session],
			sessionDeks: new Map([["session-1", encrypted.dek]]),
			events: new Map([["session-1", []]]),
		};
	},
};

let state = scenarios["refresh-restore"]();

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

	if (req.method === "GET" && url.pathname === "/api/machines") {
		json(req, res, 200, {
			machines: [
				{
					machineId: MACHINE_ID,
					hostname: "fake-gateway",
					connected: true,
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

		const allEvents = state.events.get(sessionId) ?? [];
		const events = allEvents
			.filter((event) => event.revision === revision && event.seq > afterSeq)
			.slice(0, limit);
		json(req, res, 200, {
			sessionId,
			machineId: MACHINE_ID,
			revision,
			events,
			nextAfterSeq: events.at(-1)?.seq,
			hasMore:
				allEvents.filter(
					(event) => event.revision === revision && event.seq > afterSeq,
				).length > events.length,
		});
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
			sessions: state.sessions,
		});
		return;
	}

	if (req.method === "POST" && url.pathname === "/__test__/append-event") {
		const body = await parseBody(req);
		const event = buildEvent(body);
		const existing = state.events.get(event.sessionId) ?? [];
		existing.push(event);
		state.events.set(event.sessionId, existing);
		json(req, res, 200, { ok: true, event });
		return;
	}

	if (req.method === "POST" && url.pathname === "/__test__/emit-event") {
		const body = await parseBody(req);
		const event = buildEvent(body);
		const existing = state.events.get(event.sessionId) ?? [];
		existing.push(event);
		state.events.set(event.sessionId, existing);
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

const buildEvent = ({
	sessionId = "session-1",
	revision = 1,
	seq = 1,
	text = "event",
	encrypted = false,
}) => {
	const payload = {
		sessionId,
		update: {
			sessionUpdate: "agent_message_chunk",
			content: { type: "text", text },
		},
	};
	return {
		sessionId,
		machineId: MACHINE_ID,
		revision,
		seq,
		kind: "agent_message_chunk",
		createdAt: new Date().toISOString(),
		payload:
			encrypted && state.sessionDeks.get(sessionId)
				? encryptPayload(payload, state.sessionDeks.get(sessionId))
				: payload,
		eventId: randomUUID(),
	};
};

server.listen(PORT, "127.0.0.1", () => {
	console.log(`fake gateway listening on ${PORT}`);
});
