export const FORBIDDEN_GATEWAY_CONTENT_KEYS = [
	"prompt",
	"content",
	"body",
	"description",
	"summaryText",
	"agentOutput",
	"providerToken",
	"masterSecret",
	"dek",
	"secret",
] as const;

const forbiddenKeys = new Set<string>(FORBIDDEN_GATEWAY_CONTENT_KEYS);

export function assertGatewayFacingAgentTeamPayload(value: unknown): void {
	visitGatewayPayload(value);
}

function visitGatewayPayload(value: unknown): void {
	if (!value || typeof value !== "object") {
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			visitGatewayPayload(item);
		}
		return;
	}

	for (const [key, child] of Object.entries(value)) {
		if (forbiddenKeys.has(key)) {
			throw new Error(`Forbidden Gateway-facing Agent Team key: ${key}`);
		}
		visitGatewayPayload(child);
	}
}
