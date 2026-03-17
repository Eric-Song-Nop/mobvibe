import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsMobilePlatform = vi.hoisted(() => vi.fn());
const mockScan = vi.hoisted(() => vi.fn());
const mockCancel = vi.hoisted(() => vi.fn());
const mockCheckPermissions = vi.hoisted(() => vi.fn());
const mockRequestPermissions = vi.hoisted(() => vi.fn());

vi.mock("@/lib/platform", () => ({
	isMobilePlatform: mockIsMobilePlatform,
}));

vi.mock("@tauri-apps/plugin-barcode-scanner", () => ({
	scan: mockScan,
	cancel: mockCancel,
	checkPermissions: mockCheckPermissions,
	requestPermissions: mockRequestPermissions,
	Format: {
		QRCode: "qr",
	},
}));

import { useQrScanner } from "../use-qr-scanner";

describe("useQrScanner", () => {
	beforeEach(() => {
		mockIsMobilePlatform.mockReset();
		mockScan.mockReset();
		mockCancel.mockReset();
		mockCheckPermissions.mockReset();
		mockRequestPermissions.mockReset();
		document.documentElement.classList.remove("qr-scanning");
	});

	it("clears scanning state when native cancel returns before scan settles", async () => {
		mockIsMobilePlatform.mockResolvedValue(true);
		mockCheckPermissions.mockResolvedValue("granted");
		mockScan.mockImplementation(() => new Promise<never>(() => undefined));
		mockCancel.mockResolvedValue(undefined);

		const { result } = renderHook(() => useQrScanner());

		await waitFor(() => {
			expect(result.current.canScan).toBe(true);
		});

		let scanPromise!: Promise<string | null>;

		act(() => {
			scanPromise = result.current.startScan();
		});

		await waitFor(() => {
			expect(result.current.isScanning).toBe(true);
			expect(document.documentElement.classList.contains("qr-scanning")).toBe(
				true,
			);
		});

		await act(async () => {
			await result.current.cancelScan();
		});

		await waitFor(() => {
			expect(result.current.isScanning).toBe(false);
			expect(document.documentElement.classList.contains("qr-scanning")).toBe(
				false,
			);
		});

		await expect(scanPromise).resolves.toBeNull();
		expect(mockCancel).toHaveBeenCalledTimes(1);
	});
});
