import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AgentSessionCapabilities } from "@/lib/acp";
import {
	type AcpBackendSummary,
	type AcpBackendsResponse,
	discoverSessions,
	fetchAcpBackends,
	fetchSessions,
	type SessionsResponse,
} from "@/lib/api";

export interface UseSessionQueriesReturn {
	sessionsQuery: ReturnType<typeof useQuery<SessionsResponse>>;
	backendsQuery: ReturnType<typeof useQuery<AcpBackendsResponse>>;
	availableBackends: AcpBackendSummary[];
	discoverSessionsMutation: ReturnType<typeof useDiscoverSessionsMutation>;
}

export type DiscoverSessionsVariables = {
	machineId: string;
	cwd?: string;
	backendId?: string;
	backendIds?: string[];
};

export type DiscoverSessionsMutationResult = {
	machineId: string;
	backendCapabilities: Record<string, AgentSessionCapabilities>;
};

const queryKeys = {
	sessions: ["sessions"] as const,
	backends: ["acp-backends"] as const,
};

const normalizeBackendIds = (
	backendIds: Array<string | undefined>,
): string[] => {
	const seen = new Set<string>();
	const normalized: string[] = [];
	for (const backendId of backendIds) {
		const id = backendId?.trim();
		if (!id || seen.has(id)) {
			continue;
		}
		seen.add(id);
		normalized.push(id);
	}
	return normalized;
};

export function useDiscoverSessionsMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (
			variables: DiscoverSessionsVariables,
		): Promise<DiscoverSessionsMutationResult> => {
			const backendCapabilities: Record<string, AgentSessionCapabilities> = {};
			let lastError: unknown;
			let backendIds = normalizeBackendIds([
				variables.backendId,
				...(variables.backendIds ?? []),
			]);
			const hasExplicitBackendSelection = backendIds.length > 0;
			if (backendIds.length === 0) {
				const cachedBackends = queryClient.getQueryData<AcpBackendsResponse>(
					queryKeys.backends,
				);
				backendIds = normalizeBackendIds(
					cachedBackends?.backends.map((backend) => backend.backendId) ?? [],
				);
			}

			if (backendIds.length === 0) {
				try {
					const fetchedBackends = await queryClient.fetchQuery({
						queryKey: queryKeys.backends,
						queryFn: fetchAcpBackends,
					});
					backendIds = normalizeBackendIds(
						fetchedBackends.backends.map((backend) => backend.backendId),
					);
				} catch {
					// No backends available — cannot discover.
				}
			}

			if (backendIds.length === 0) {
				throw new Error("No backends available for session discovery");
			}

			const results = await Promise.allSettled(
				backendIds.map(async (backendId) => {
					let cursor: string | undefined;
					let caps: AgentSessionCapabilities | undefined;
					do {
						const result = await discoverSessions({
							machineId: variables.machineId,
							cwd: variables.cwd,
							cursor,
							backendId,
						});
						// Use latest capabilities per page (they shouldn't change between pages)
						caps = { ...result.capabilities };
						cursor = result.nextCursor;
					} while (cursor);
					return { backendId, caps: caps! };
				}),
			);

			if (hasExplicitBackendSelection || backendIds.length === 1) {
				const rejected = results.find(
					(r): r is PromiseRejectedResult => r.status === "rejected",
				);
				if (rejected) {
					throw rejected.reason;
				}
			}

			for (const r of results) {
				if (r.status === "fulfilled" && r.value.caps) {
					backendCapabilities[r.value.backendId] = r.value.caps;
				} else if (r.status === "rejected") {
					lastError = r.reason;
				}
			}

			if (Object.keys(backendCapabilities).length === 0) {
				if (lastError) {
					throw lastError;
				}
				throw new Error("Missing session capabilities from discovery response");
			}

			return { machineId: variables.machineId, backendCapabilities };
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
		},
	});
}

/**
 * Hook to fetch sessions and backends data.
 * Returns query objects and derived data.
 */
export function useSessionQueries(): UseSessionQueriesReturn {
	// Fetch sessions once on mount; real-time updates come via sessions:changed socket event
	// Sessions — socket-driven, never refetch automatically
	const sessionsQuery = useQuery({
		queryKey: queryKeys.sessions,
		queryFn: fetchSessions,
		staleTime: Number.POSITIVE_INFINITY,
	});

	// Backends — rarely changes
	const backendsQuery = useQuery({
		queryKey: queryKeys.backends,
		queryFn: fetchAcpBackends,
		staleTime: 5 * 60_000,
	});

	const availableBackends = backendsQuery.data?.backends ?? [];
	const discoverSessionsMutation = useDiscoverSessionsMutation();

	return {
		sessionsQuery,
		backendsQuery,
		availableBackends,
		discoverSessionsMutation,
	};
}
