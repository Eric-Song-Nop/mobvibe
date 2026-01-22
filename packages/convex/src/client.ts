/**
 * Convex client utilities for use by gateway and other Node.js services.
 */

import { ConvexHttpClient } from "convex/browser";

/**
 * Create a Convex HTTP client for server-side use.
 * This client is used by the gateway to call Convex mutations/queries.
 *
 * @param convexUrl - Convex deployment URL (e.g., https://your-project.convex.cloud)
 * @returns ConvexHttpClient instance
 */
export function createConvexClient(convexUrl: string): ConvexHttpClient {
	return new ConvexHttpClient(convexUrl);
}

export { ConvexHttpClient };
