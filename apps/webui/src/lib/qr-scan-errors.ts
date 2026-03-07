export type QrScanErrorCode =
	| "camera_permission_denied"
	| "camera_policy_blocked"
	| "camera_unavailable";

const policyBlockedPatterns = [
	"permissions policy",
	"camera is not allowed in this document",
	'access to the feature "camera" is disallowed',
	"document is not allowed to use camera",
];

const permissionDeniedPatterns = [
	"camera_permission_denied",
	"permission denied",
	"permission dismissed",
	"notallowederror",
];

const unavailablePatterns = [
	"notfounderror",
	"devices not found",
	"requested device not found",
	"no camera found",
	"camera not found",
];

function getErrorText(error: unknown): string {
	if (error instanceof DOMException) {
		return `${error.name}: ${error.message}`;
	}
	if (error instanceof Error) {
		return `${error.name}: ${error.message}`;
	}
	return String(error);
}

export function getQrScanErrorCode(error: unknown): QrScanErrorCode | null {
	const message = getErrorText(error).toLowerCase();

	if (policyBlockedPatterns.some((pattern) => message.includes(pattern))) {
		return "camera_policy_blocked";
	}

	if (permissionDeniedPatterns.some((pattern) => message.includes(pattern))) {
		return "camera_permission_denied";
	}

	if (unavailablePatterns.some((pattern) => message.includes(pattern))) {
		return "camera_unavailable";
	}

	return null;
}
