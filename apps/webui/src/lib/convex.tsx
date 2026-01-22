import { ConvexProvider, ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";

const CONVEX_URL = import.meta.env.VITE_CONVEX_URL as string | undefined;

// Create Convex client only if URL is configured
const convexClient = CONVEX_URL ? new ConvexReactClient(CONVEX_URL) : null;

export function isConvexEnabled(): boolean {
	return convexClient !== null;
}

export function getConvexClient(): ConvexReactClient | null {
	return convexClient;
}

type ConvexProviderWrapperProps = {
	children: ReactNode;
};

export function ConvexProviderWrapper({ children }: ConvexProviderWrapperProps) {
	if (!convexClient) {
		return <>{children}</>;
	}
	return <ConvexProvider client={convexClient}>{children}</ConvexProvider>;
}
