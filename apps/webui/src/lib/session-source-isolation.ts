import type {
	AgentSessionCapabilities,
	GatewaySessionsChangedPayload,
	SessionSummary,
} from "@mobvibe/shared";

type SessionSourceState = {
	machineId?: string;
};

type SessionsById = Record<string, SessionSourceState | undefined>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const getCanonicalMachineId = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim().length > 0 ? value : undefined;

const getSessionId = (value: unknown): string | undefined => {
	if (!isRecord(value)) return undefined;
	const { sessionId } = value;
	return typeof sessionId === "string" && sessionId.length > 0
		? sessionId
		: undefined;
};

const getCompatibleSession = (
	value: unknown,
	sourceMachineId: string,
	sessions: SessionsById,
): SessionSummary | undefined => {
	const sessionId = getSessionId(value);
	if (!sessionId || !isRecord(value)) return undefined;
	if (getCanonicalMachineId(value.machineId) !== sourceMachineId) {
		return undefined;
	}
	const existing = sessions[sessionId];
	const existingMachineId = getCanonicalMachineId(existing?.machineId);
	if (existingMachineId && existingMachineId !== sourceMachineId) {
		return undefined;
	}
	return value as SessionSummary;
};

/**
 * Validate a Gateway session delta before any reducer or runtime side effects.
 * Missing sources and cross-machine session-id collisions fail closed.
 */
export const isolateGatewaySessionDelta = (
	value: unknown,
	sessions: SessionsById,
): GatewaySessionsChangedPayload | undefined => {
	if (!isRecord(value)) return undefined;
	const rawAdded = Array.isArray(value.added) ? value.added : [];
	const rawUpdated = Array.isArray(value.updated) ? value.updated : [];
	const explicitMachineId = getCanonicalMachineId(value.machineId);
	let machineId = explicitMachineId;
	if (!machineId) {
		const summaries = [...rawAdded, ...rawUpdated];
		const sources = new Set(
			summaries.flatMap((summary) => {
				if (!isRecord(summary)) return [];
				const source = getCanonicalMachineId(summary.machineId);
				return source ? [source] : [];
			}),
		);
		if (summaries.length === 0 || sources.size !== 1) return undefined;
		if (
			summaries.some(
				(summary) =>
					!isRecord(summary) ||
					getCanonicalMachineId(summary.machineId) === undefined,
			)
		) {
			return undefined;
		}
		machineId = Array.from(sources)[0];
	}

	const added = rawAdded.flatMap((summary) => {
		const accepted = getCompatibleSession(summary, machineId, sessions);
		return accepted ? [accepted] : [];
	});
	const updated = rawUpdated.flatMap((summary) => {
		const accepted = getCompatibleSession(summary, machineId, sessions);
		return accepted ? [accepted] : [];
	});
	const removed = explicitMachineId
		? (Array.isArray(value.removed) ? value.removed : []).flatMap(
				(sessionId) => {
					if (typeof sessionId !== "string" || sessionId.length === 0) {
						return [];
					}
					const existingMachineId = getCanonicalMachineId(
						sessions[sessionId]?.machineId,
					);
					return existingMachineId === machineId ? [sessionId] : [];
				},
			)
		: [];
	const backendCapabilities =
		explicitMachineId && isRecord(value.backendCapabilities)
			? (value.backendCapabilities as Record<string, AgentSessionCapabilities>)
			: undefined;

	if (
		added.length === 0 &&
		updated.length === 0 &&
		removed.length === 0 &&
		backendCapabilities === undefined
	) {
		return undefined;
	}

	return {
		machineId,
		added,
		updated,
		removed,
		...(backendCapabilities ? { backendCapabilities } : {}),
	};
};

export const isSessionMachineEventAccepted = (
	value: unknown,
	sessions: SessionsById,
): boolean => {
	if (!isRecord(value)) return false;
	const sessionId = getSessionId(value);
	const machineId = getCanonicalMachineId(value.machineId);
	if (!sessionId || !machineId) return false;
	const existingMachineId = getCanonicalMachineId(
		sessions[sessionId]?.machineId,
	);
	return existingMachineId === undefined || existingMachineId === machineId;
};

export const resolveCoveredMachineIds = (
	summaries: SessionSummary[],
	value: unknown,
): string[] => {
	const candidates = Array.isArray(value)
		? value
		: summaries.map((summary) => summary.machineId);
	return Array.from(
		new Set(
			candidates.flatMap((candidate) => {
				const machineId = getCanonicalMachineId(candidate);
				return machineId ? [machineId] : [];
			}),
		),
	);
};

export type IsolatedSessionSnapshot = {
	summaries: SessionSummary[];
	protectedSessionIds: string[];
};

/**
 * Select HTTP summaries whose source is covered and unambiguous.
 * Conflicted ids are protected from coverage-based deletion so last-good state
 * survives a malformed or legacy snapshot.
 */
export const isolateSessionSnapshot = (
	summaries: SessionSummary[],
	coveredMachineIds: string[],
	sessions: SessionsById,
): IsolatedSessionSnapshot => {
	const coveredMachines = new Set(
		coveredMachineIds.flatMap((candidate) => {
			const machineId = getCanonicalMachineId(candidate);
			return machineId ? [machineId] : [];
		}),
	);
	const candidatesById = new Map<string, SessionSummary[]>();
	for (const summary of summaries) {
		const sessionId = getSessionId(summary);
		if (!sessionId) continue;
		const candidates = candidatesById.get(sessionId) ?? [];
		candidates.push(summary);
		candidatesById.set(sessionId, candidates);
	}

	const accepted: SessionSummary[] = [];
	const protectedSessionIds = new Set<string>();
	for (const [sessionId, candidates] of candidatesById) {
		const sources = new Set<string>();
		let hasInvalidSource = false;
		for (const candidate of candidates) {
			const machineId = getCanonicalMachineId(candidate.machineId);
			if (!machineId || !coveredMachines.has(machineId)) {
				hasInvalidSource = true;
				continue;
			}
			sources.add(machineId);
		}
		const existingMachineId = getCanonicalMachineId(
			sessions[sessionId]?.machineId,
		);
		const conflictsWithExisting =
			existingMachineId !== undefined && !sources.has(existingMachineId);
		if (hasInvalidSource || sources.size !== 1 || conflictsWithExisting) {
			protectedSessionIds.add(sessionId);
			continue;
		}
		accepted.push(candidates[candidates.length - 1]);
	}

	return {
		summaries: accepted,
		protectedSessionIds: Array.from(protectedSessionIds).sort(),
	};
};
