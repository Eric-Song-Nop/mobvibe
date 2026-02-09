import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type AcpBackendSummary,
	type AcpBackendsResponse,
	type DiscoverSessionsResult,
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
	capabilities: DiscoverSessionsResult["capabilities"];
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
			let capabilities: DiscoverSessionsResult["capabilities"] | undefined;
			let lastError: unknown;
			const hasExplicitBackendSelection =
				normalizeBackendIds([
					variables.backendId,
					...(variables.backendIds ?? []),
				]).length > 0;
			let backendIds = normalizeBackendIds([
				variables.backendId,
				...(variables.backendIds ?? []),
			]);
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
					let caps: DiscoverSessionsResult["capabilities"] | undefined;
					do {
						const result = await discoverSessions({
							machineId: variables.machineId,
							cwd: variables.cwd,
							cursor,
							backendId,
						});
						caps = caps
							? {
									list: caps.list || result.capabilities.list,
									load: caps.load || result.capabilities.load,
								}
							: { ...result.capabilities };
						cursor = result.nextCursor;
					} while (cursor);
					return caps;
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
				if (r.status === "fulfilled" && r.value) {
					capabilities = capabilities
						? {
								list: capabilities.list || r.value.list,
								load: capabilities.load || r.value.load,
							}
						: { ...r.value };
				} else if (r.status === "rejected") {
					lastError = r.reason;
				}
			}

			if (!capabilities) {
				if (lastError) {
					throw lastError;
				}
				throw new Error("Missing session capabilities from discovery response");
			}

			return { machineId: variables.machineId, capabilities };
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
