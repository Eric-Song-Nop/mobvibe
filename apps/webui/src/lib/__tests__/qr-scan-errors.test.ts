import { describe, expect, it } from "vitest";
import { getQrScanErrorCode, isIgnorableQrScanError } from "../qr-scan-errors";

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

	it("treats missing QR results as ignorable scan noise", () => {
		expect(isIgnorableQrScanError("No QR code found")).toBe(true);
		expect(isIgnorableQrScanError("Scanner error: No QR code found")).toBe(
			true,
		);
	});

	it("does not ignore real QR scan failures", () => {
		expect(isIgnorableQrScanError("Scanner error: timeout")).toBe(false);
	});
});
