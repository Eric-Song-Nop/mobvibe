import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type AcpBackendSummary,
	type AcpBackendsResponse,
	discoverSessions,
	fetchAcpBackends,
	fetchSessions,
	type DiscoverSessionsResult,
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
};

export type DiscoverSessionsMutationResult = {
	machineId: string;
	capabilities: DiscoverSessionsResult["capabilities"];
};

export function useDiscoverSessionsMutation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (
			variables: DiscoverSessionsVariables,
		): Promise<DiscoverSessionsMutationResult> => {
			let cursor: string | undefined;
			let capabilities: DiscoverSessionsResult["capabilities"] | undefined;
			do {
				const result = await discoverSessions({
					machineId: variables.machineId,
					cwd: variables.cwd,
					cursor,
				});
				capabilities = result.capabilities;
				cursor = result.nextCursor;
			} while (cursor);

			if (!capabilities) {
				throw new Error("Missing session capabilities from discovery response");
			}

			return { machineId: variables.machineId, capabilities };
		},
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["sessions"] });
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
		queryKey: ["sessions"],
		queryFn: fetchSessions,
	});

	const backendsQuery = useQuery({
		queryKey: ["acp-backends"],
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
