import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/components/auth/AuthProvider";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			staleTime: 60_000,
			refetchOnWindowFocus: false,
		},
	},
});

type AppProvidersProps = {
	children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
	return (
		<BrowserRouter>
			<QueryClientProvider client={queryClient}>
				<AuthProvider>{children}</AuthProvider>
			</QueryClientProvider>
		</BrowserRouter>
	);
}
