import { describe, expect, it } from "vitest";
import { getQrScanErrorCode } from "../qr-scan-errors";

describe("getQrScanErrorCode", () => {
	it("classifies permissions policy camera violations", () => {
		const error = new Error(
			"[Violation] Permissions policy violation: camera is not allowed in this document",
		);

		expect(getQrScanErrorCode(error)).toBe("camera_policy_blocked");
	});

	it("classifies camera permission denials", () => {
		const error = new DOMException(
			"The request is not allowed by the user agent or the platform in the current context.",
			"NotAllowedError",
		);

		expect(getQrScanErrorCode(error)).toBe("camera_permission_denied");
	});

	it("classifies missing cameras", () => {
		const error = new DOMException(
			"Requested device not found",
			"NotFoundError",
		);

		expect(getQrScanErrorCode(error)).toBe("camera_unavailable");
	});
});
