import { useQuery } from "@tanstack/react-query";
import {
	type AcpBackendSummary,
	type AcpBackendsResponse,
	fetchAcpBackends,
	fetchSessions,
	type SessionsResponse,
} from "@/lib/api";

export interface UseSessionQueriesReturn {
	sessionsQuery: ReturnType<typeof useQuery<SessionsResponse>>;
	backendsQuery: ReturnType<typeof useQuery<AcpBackendsResponse>>;
	availableBackends: AcpBackendSummary[];
	defaultBackendId: string | undefined;
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

	return {
		sessionsQuery,
		backendsQuery,
		availableBackends,
		defaultBackendId,
	};
}
