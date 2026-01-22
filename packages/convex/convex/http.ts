import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { api } from "./_generated/api";

const http = httpRouter();

/**
 * Better Auth HTTP routes.
 * These handle OAuth callbacks, email verification, etc.
 */
authComponent.registerRoutes(http, createAuth);

/**
 * Machine registration endpoint.
 * Called from the WebUI machine callback page during CLI login flow.
 */
http.route({
	path: "/api/machines/register",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		// Get session token from Authorization header
		const authHeader = request.headers.get("Authorization");
		if (!authHeader?.startsWith("Bearer ")) {
			return new Response(
				JSON.stringify({ error: "Missing or invalid authorization header" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			);
		}

		const sessionToken = authHeader.slice(7);

		// Validate session and get user
		const auth = createAuth(ctx);
		const session = await auth.api.getSession({
			headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
		});

		if (!session?.user) {
			return new Response(
				JSON.stringify({ error: "Invalid session" }),
				{ status: 401, headers: { "Content-Type": "application/json" } },
			);
		}

		// Parse request body
		let body: { name: string; hostname: string; platform: string };
		try {
			body = await request.json();
		} catch {
			return new Response(
				JSON.stringify({ error: "Invalid request body" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		if (!body.name || !body.hostname || !body.platform) {
			return new Response(
				JSON.stringify({ error: "Missing required fields: name, hostname, platform" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}

		// Register the machine (we need to do this directly since we can't pass auth context)
		const machineToken = generateMachineToken();
		const now = Date.now();

		const machineId = await ctx.runMutation(api.machines.registerMachineInternal, {
			userId: session.user.id,
			name: body.name,
			hostname: body.hostname,
			platform: body.platform,
			machineToken,
			createdAt: now,
		});

		return new Response(
			JSON.stringify({
				machineId,
				machineToken,
				userId: session.user.id,
				email: session.user.email,
			}),
			{
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"Access-Control-Allow-Origin": "*",
				},
			},
		);
	}),
});

// CORS preflight for machine registration
http.route({
	path: "/api/machines/register",
	method: "OPTIONS",
	handler: httpAction(async () => {
		return new Response(null, {
			status: 204,
			headers: {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "POST, OPTIONS",
				"Access-Control-Allow-Headers": "Content-Type, Authorization",
			},
		});
	}),
});

/**
 * Generate a secure random token for machine authentication.
 */
function generateMachineToken(): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

export default http;
