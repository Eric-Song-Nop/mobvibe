import type {
	AgentAuthenticationCapabilities,
	AgentAuthMethod,
	AgentCapabilitiesRpcResult,
} from "@mobvibe/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
	authenticateAgent,
	fetchAgentCapabilities,
	logoutAgent,
} from "@/lib/api";

const MAX_AUTH_METHODS = 32;
const MAX_AUTH_METHOD_CANDIDATES = 64;
const MAX_AUTH_METHOD_ID_LENGTH = 256;
const MAX_AUTH_METHOD_NAME_LENGTH = 128;
const MAX_AUTH_METHOD_DESCRIPTION_LENGTH = 512;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

type AgentAuthActionKind = "authenticate" | "logout";

type AgentAuthActionVariables = {
	backendId: string;
	controller: AbortController;
	kind: AgentAuthActionKind;
	machineId: string;
	methodId?: string;
};

type ActiveAgentAuthAction = Pick<
	AgentAuthActionVariables,
	"backendId" | "controller" | "machineId"
>;

export type UseAgentAuthenticationOptions = {
	backendId?: string;
	enabled: boolean;
	machineId?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const normalizeDisplayText = (
	value: unknown,
	maxLength: number,
): string | undefined => {
	if (typeof value !== "string") {
		return undefined;
	}
	const normalized = value.trim();
	if (!normalized || CONTROL_CHARACTER_PATTERN.test(normalized)) {
		return undefined;
	}
	if (normalized.length <= maxLength) {
		return normalized;
	}
	return `${normalized.slice(0, maxLength - 1)}…`;
};

const normalizeAuthMethod = (value: unknown): AgentAuthMethod | undefined => {
	if (!isRecord(value) || typeof value.id !== "string") {
		return undefined;
	}
	const id = value.id;
	if (
		!id.trim() ||
		id !== id.trim() ||
		id.length > MAX_AUTH_METHOD_ID_LENGTH ||
		CONTROL_CHARACTER_PATTERN.test(id)
	) {
		return undefined;
	}
	const name = normalizeDisplayText(value.name, MAX_AUTH_METHOD_NAME_LENGTH);
	if (!name) {
		return undefined;
	}
	return {
		id,
		name,
		description: normalizeDisplayText(
			value.description,
			MAX_AUTH_METHOD_DESCRIPTION_LENGTH,
		),
	};
};

export const normalizeAgentAuthenticationCapabilities = (
	value: unknown,
): AgentAuthenticationCapabilities | undefined => {
	if (!isRecord(value)) {
		return undefined;
	}
	const methods: AgentAuthMethod[] = [];
	const seenMethodIds = new Set<string>();
	const candidates = Array.isArray(value.methods)
		? value.methods.slice(0, MAX_AUTH_METHOD_CANDIDATES)
		: [];
	for (const candidate of candidates) {
		const method = normalizeAuthMethod(candidate);
		if (!method || seenMethodIds.has(method.id)) {
			continue;
		}
		seenMethodIds.add(method.id);
		methods.push(method);
		if (methods.length === MAX_AUTH_METHODS) {
			break;
		}
	}
	const logout = value.logout === true;
	if (methods.length === 0 && !logout) {
		return undefined;
	}
	return { methods, logout };
};

const extractAuthenticationCapabilities = (
	result: unknown,
): AgentAuthenticationCapabilities | null => {
	if (!isRecord(result) || !isRecord(result.capabilities)) {
		return null;
	}
	return (
		normalizeAgentAuthenticationCapabilities(result.capabilities.auth) ?? null
	);
};

const isAbortError = (error: unknown): boolean =>
	error instanceof DOMException
		? error.name === "AbortError"
		: error instanceof Error && error.name === "AbortError";

export const agentCapabilitiesQueryKey = (
	machineId: string,
	backendId: string,
) => ["agent-capabilities", machineId, backendId] as const;

const actionMatchesSelection = (
	variables: AgentAuthActionVariables | undefined,
	machineId: string | undefined,
	backendId: string | undefined,
) =>
	variables !== undefined &&
	variables.machineId === machineId &&
	variables.backendId === backendId;

export function useAgentAuthentication({
	backendId,
	enabled,
	machineId,
}: UseAgentAuthenticationOptions) {
	const queryClient = useQueryClient();
	const activeActionRef = useRef<ActiveAgentAuthAction | null>(null);
	const canRequestCapabilities =
		enabled && Boolean(machineId) && Boolean(backendId);

	const capabilitiesQuery = useQuery({
		queryKey: agentCapabilitiesQueryKey(machineId ?? "", backendId ?? ""),
		queryFn: async ({ signal }) =>
			extractAuthenticationCapabilities(
				await fetchAgentCapabilities(
					{ backendId: backendId!, machineId: machineId! },
					signal,
				),
			),
		enabled: canRequestCapabilities,
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: 15_000,
	});

	const actionMutation = useMutation({
		mutationFn: async (
			variables: AgentAuthActionVariables,
		): Promise<AgentCapabilitiesRpcResult> => {
			const target = {
				backendId: variables.backendId,
				machineId: variables.machineId,
			};
			if (variables.kind === "logout") {
				return logoutAgent(target, variables.controller.signal);
			}
			return authenticateAgent(
				{ ...target, methodId: variables.methodId! },
				variables.controller.signal,
			);
		},
		onSuccess: async (result, variables) => {
			const queryKey = agentCapabilitiesQueryKey(
				variables.machineId,
				variables.backendId,
			);
			queryClient.setQueryData(
				queryKey,
				extractAuthenticationCapabilities(result),
			);
			await Promise.all([
				queryClient.invalidateQueries({ exact: true, queryKey }),
				queryClient.invalidateQueries({ queryKey: ["sessions"] }),
				queryClient.invalidateQueries({ queryKey: ["machines"] }),
			]);
		},
		onSettled: (_data, _error, variables) => {
			if (activeActionRef.current?.controller === variables.controller) {
				activeActionRef.current = null;
			}
		},
	});

	useEffect(() => {
		return () => {
			const activeAction = activeActionRef.current;
			if (
				activeAction &&
				enabled &&
				activeAction.machineId === machineId &&
				activeAction.backendId === backendId
			) {
				activeAction.controller.abort();
				activeActionRef.current = null;
			}
		};
	}, [backendId, enabled, machineId]);

	const startAction = (kind: AgentAuthActionKind, methodId?: string): void => {
		if (!enabled || !machineId || !backendId || activeActionRef.current) {
			return;
		}
		const capabilities = capabilitiesQuery.data;
		if (
			kind === "authenticate" &&
			(!methodId ||
				!capabilities?.methods.some((method) => method.id === methodId))
		) {
			return;
		}
		if (kind === "logout" && !capabilities?.logout) {
			return;
		}
		const controller = new AbortController();
		activeActionRef.current = { backendId, controller, machineId };
		actionMutation.mutate({
			backendId,
			controller,
			kind,
			machineId,
			methodId,
		});
	};

	const actionAppliesToSelection = actionMatchesSelection(
		actionMutation.variables,
		machineId,
		backendId,
	);
	const actionError =
		actionAppliesToSelection &&
		actionMutation.isError &&
		!isAbortError(actionMutation.error)
			? actionMutation.error
			: undefined;

	return {
		actionError,
		actionKind: actionAppliesToSelection
			? actionMutation.variables?.kind
			: undefined,
		actionMethodId: actionAppliesToSelection
			? actionMutation.variables?.methodId
			: undefined,
		actionSucceeded: actionAppliesToSelection && actionMutation.isSuccess,
		authenticate: (methodId: string) => startAction("authenticate", methodId),
		capabilities: capabilitiesQuery.data ?? undefined,
		capabilitiesQuery,
		isActionPending: actionAppliesToSelection && actionMutation.isPending,
		logout: () => startAction("logout"),
	};
}
