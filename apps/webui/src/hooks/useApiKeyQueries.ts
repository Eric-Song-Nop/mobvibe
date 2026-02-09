import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ApiKeyData, apiKey } from "@/lib/auth";

const queryKeys = {
	apiKeys: ["apiKeys"] as const,
};

export function useApiKeysQuery(enabled: boolean) {
	return useQuery<ApiKeyData[]>({
		queryKey: queryKeys.apiKeys,
		queryFn: async () => {
			const result = await apiKey.list();
			if (result.error) {
				throw new Error(result.error.message ?? "Failed to load API keys");
			}
			return result.data ?? [];
		},
		enabled,
	});
}

export function useCreateApiKeyMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data: { name?: string; expiresIn?: number }) =>
			apiKey.create(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
		},
	});
}

export function useDeleteApiKeyMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (data: { keyId: string }) => apiKey.delete(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
		},
	});
}
