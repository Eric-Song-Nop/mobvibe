import { useCallback, useEffect, useRef, useState } from "react";
import { isMobilePlatform } from "@/lib/platform";

interface UseQrScannerReturn {
	/** Whether camera scanning is supported (browser has mediaDevices or Tauri mobile) */
	canScan: boolean;
	/** Whether a scan is currently in progress */
	isScanning: boolean;
	/** Start scanning, resolves with decoded string or null if cancelled */
	startScan: () => Promise<string | null>;
	/** Cancel the active scan */
	cancelScan: () => Promise<void>;
	/** Video element ref for Web camera preview (unused on Tauri mobile) */
	videoRef: React.RefObject<HTMLVideoElement | null>;
}

/**
 * Cross-platform QR code scanner hook.
 *
 * Automatically selects the scanning strategy based on the runtime:
 * - **Tauri mobile** (Android/iOS): uses `@tauri-apps/plugin-barcode-scanner`
 *   with a `popstate` workaround so the Android back button cancels the scan.
 * - **Web browser**: uses `qr-scanner` (WebWorker-based, ~16 kB gzip) with
 *   `navigator.mediaDevices.getUserMedia` via a `<video>` element.
 */
export function useQrScanner(): UseQrScannerReturn {
	const [canScan, setCanScan] = useState(false);
	const [isScanning, setIsScanning] = useState(false);
	const [isTauriMobile, setIsTauriMobile] = useState(false);
	const videoRef = useRef<HTMLVideoElement | null>(null);

	// Mutable refs for imperative cancel / cleanup
	const cancelRef = useRef<(() => Promise<void>) | null>(null);
	const cleanupRef = useRef<(() => void) | null>(null);

	// Detect platform capabilities on mount
	useEffect(() => {
		let cancelled = false;

		(async () => {
			const mobile = await isMobilePlatform();
			if (cancelled) return;

			if (mobile) {
				setIsTauriMobile(true);
				setCanScan(true);
				return;
			}

			// Web: check for camera support
			if (typeof navigator !== "undefined" && navigator.mediaDevices) {
				try {
					const { default: QrScanner } = await import("qr-scanner");
					const has = await QrScanner.hasCamera();
					if (!cancelled) setCanScan(has);
				} catch {
					if (!cancelled) setCanScan(false);
				}
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	const startScan = useCallback(async (): Promise<string | null> => {
		setIsScanning(true);

		try {
			if (isTauriMobile) {
				return await startTauriScan(cancelRef);
			}
			return await startWebScan(videoRef, cancelRef, cleanupRef);
		} finally {
			cleanupRef.current?.();
			cleanupRef.current = null;
			cancelRef.current = null;
			setIsScanning(false);
		}
	}, [isTauriMobile]);

	const cancelScan = useCallback(async () => {
		try {
			await cancelRef.current?.();
		} catch (err) {
			console.error("Failed to cancel scan:", err);
		}
	}, []);

	return { canScan, isScanning, startScan, cancelScan, videoRef };
}

/* ------------------------------------------------------------------ */
/*  Tauri mobile strategy                                              */
/* ------------------------------------------------------------------ */

async function startTauriScan(
	cancelRef: React.MutableRefObject<(() => Promise<void>) | null>,
): Promise<string | null> {
	const { scan, cancel, Format, checkPermissions, requestPermissions } =
		await import("@tauri-apps/plugin-barcode-scanner");

	// Permission check
	let permState = await checkPermissions();
	if (permState === "prompt") {
		permState = await requestPermissions();
	}
	if (permState !== "granted") {
		throw new Error("camera_permission_denied");
	}

	// Android back-button workaround: push a fake history entry so
	// pressing Back triggers popstate instead of exiting the app.
	history.pushState({ qrScan: true }, "", location.href);

	let popstateCleanup: (() => void) | null = null;

	const onPopstate = () => {
		void cancel();
	};
	window.addEventListener("popstate", onPopstate);
	popstateCleanup = () => {
		window.removeEventListener("popstate", onPopstate);
		// Clean up the fake history entry if scan completed normally
		if (history.state?.qrScan) {
			history.back();
		}
	};

	cancelRef.current = async () => {
		await cancel();
	};

	try {
		const result = await scan({ formats: [Format.QRCode] });
		popstateCleanup();
		popstateCleanup = null;
		return result?.content ?? null;
	} catch (err) {
		popstateCleanup?.();
		popstateCleanup = null;
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.toLowerCase().includes("cancel")) {
			return null;
		}
		throw err;
	}
}

/* ------------------------------------------------------------------ */
/*  Web browser strategy                                               */
/* ------------------------------------------------------------------ */

async function startWebScan(
	videoRef: React.RefObject<HTMLVideoElement | null>,
	cancelRef: React.MutableRefObject<(() => Promise<void>) | null>,
	cleanupRef: React.MutableRefObject<(() => void) | null>,
): Promise<string | null> {
	const { default: QrScanner } = await import("qr-scanner");

	const videoEl = videoRef.current;
	if (!videoEl) {
		throw new Error("Video element not mounted");
	}

	return new Promise<string | null>((resolve, reject) => {
		let resolved = false;

		const scanner = new QrScanner(
			videoEl,
			(result) => {
				if (resolved) return;
				resolved = true;
				scanner.stop();
				scanner.destroy();
				resolve(result.data);
			},
			{
				preferredCamera: "environment",
				highlightScanRegion: false,
				highlightCodeOutline: false,
				returnDetailedScanResult: true,
			},
		);

		const cleanup = () => {
			if (!resolved) {
				resolved = true;
				scanner.stop();
				scanner.destroy();
			}
		};

		cleanupRef.current = cleanup;

		cancelRef.current = async () => {
			cleanup();
			resolve(null);
		};

		scanner.start().catch((err: unknown) => {
			cleanup();
			if (!resolved) {
				resolved = true;
				reject(err);
			}
		});
	});
}
