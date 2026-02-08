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
	defaultBackendId: string | undefined;
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
				backendIds = normalizeBackendIds([
					cachedBackends?.defaultBackendId,
					...(cachedBackends?.backends.map((backend) => backend.backendId) ??
						[]),
				]);
			}

			if (backendIds.length === 0) {
				try {
					const fetchedBackends = await queryClient.fetchQuery({
						queryKey: queryKeys.backends,
						queryFn: fetchAcpBackends,
					});
					backendIds = normalizeBackendIds([
						fetchedBackends.defaultBackendId,
						...fetchedBackends.backends.map((backend) => backend.backendId),
					]);
				} catch {
					// Fall back to the agent's default backend.
				}
			}

			const backendsToDiscover: Array<string | undefined> =
				backendIds.length > 0 ? backendIds : [undefined];
			for (const backendId of backendsToDiscover) {
				let cursor: string | undefined;
				try {
					do {
						const result = await discoverSessions({
							machineId: variables.machineId,
							cwd: variables.cwd,
							cursor,
							...(backendId ? { backendId } : {}),
						});
						if (!capabilities) {
							capabilities = { ...result.capabilities };
						} else {
							capabilities = {
								list: capabilities.list || result.capabilities.list,
								load: capabilities.load || result.capabilities.load,
							};
						}
						cursor = result.nextCursor;
					} while (cursor);
				} catch (error) {
					lastError = error;
					if (hasExplicitBackendSelection || backendsToDiscover.length === 1) {
						throw error;
					}
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
	const sessionsQuery = useQuery({
		queryKey: queryKeys.sessions,
		queryFn: fetchSessions,
	});

	const backendsQuery = useQuery({
		queryKey: queryKeys.backends,
		queryFn: fetchAcpBackends,
	});

	const availableBackends = backendsQuery.data?.backends ?? [];
	const defaultBackendId =
		backendsQuery.data?.defaultBackendId || availableBackends[0]?.backendId;
	const discoverSessionsMutation = useDiscoverSessionsMutation();

	return {
		sessionsQuery,
		backendsQuery,
		availableBackends,
		defaultBackendId,
		discoverSessionsMutation,
	};
}
