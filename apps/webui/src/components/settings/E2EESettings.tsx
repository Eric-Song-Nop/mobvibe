import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useQrScanner } from "@/hooks/use-qr-scanner";
import type { SessionsResponse } from "@/lib/api";
import { isInTauri } from "@/lib/auth";
import { useChatStore } from "@/lib/chat-store";
import { e2ee } from "@/lib/e2ee";

interface PairedDevice {
	secret: string;
	fingerprint: string;
}

function base64urlToBase64(base64url: string): string {
	let b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
	const pad = b64.length % 4;
	if (pad === 2) b64 += "==";
	else if (pad === 3) b64 += "=";
	return b64;
}

export function parsePairingUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== "mobvibe:" || parsed.hostname !== "pair") {
			return null;
		}
		const secret = parsed.searchParams.get("secret");
		if (!secret) return null;
		return base64urlToBase64(secret);
	} catch {
		return null;
	}
}

/* ------------------------------------------------------------------ */
/*  Scanner Overlay (shown while camera is active)                     */
/* ------------------------------------------------------------------ */

function ScannerOverlay({
	onCancel,
	videoRef,
}: {
	onCancel: () => void;
	videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
	const { t } = useTranslation();
	const isTauri = isInTauri();

	return (
		<div className="fixed inset-0 z-[9999]">
			{/* Web: video background behind the overlay masks */}
			{!isTauri && (
				<video
					ref={videoRef}
					autoPlay
					playsInline
					muted
					className="absolute inset-0 h-full w-full object-cover"
				/>
			)}

			<div className="relative flex h-full w-full flex-col items-center justify-center">
				{/* Top mask */}
				<div className="w-full flex-1 bg-black/60" />

				{/* Middle row: left mask + scan frame + right mask */}
				<div className="flex w-full items-center justify-center">
					<div className="h-64 flex-1 bg-black/60" />
					<div className="relative h-64 w-64">
						{/* Corner decorations */}
						<div className="absolute top-0 left-0 h-6 w-6 border-t-2 border-l-2 border-white" />
						<div className="absolute top-0 right-0 h-6 w-6 border-t-2 border-r-2 border-white" />
						<div className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-white" />
						<div className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-white" />
					</div>
					<div className="h-64 flex-1 bg-black/60" />
				</div>

				{/* Hint text */}
				<div className="w-full bg-black/60 pt-6 pb-2 text-center">
					<p className="text-sm text-white/80">{t("e2ee.scanOverlayHint")}</p>
				</div>

				{/* Bottom mask + cancel button */}
				<div className="w-full flex-1 bg-black/60 flex flex-col items-center pt-8 pb-[calc(2rem+env(safe-area-inset-bottom))]">
					<button
						type="button"
						onClick={onCancel}
						className="flex items-center gap-2 rounded-full bg-white/20 px-6 py-3 text-sm font-medium text-white backdrop-blur-sm transition-colors active:bg-white/30"
					>
						<HugeiconsIcon
							icon={Cancel01Icon}
							strokeWidth={2}
							className="size-5"
						/>
						{t("common.cancel")}
					</button>
				</div>
			</div>
		</div>
	);
}

/* ------------------------------------------------------------------ */
/*  E2EE Settings                                                      */
/* ------------------------------------------------------------------ */

export function E2EESettings() {
	const { t } = useTranslation();
	const [secret, setSecret] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [removeTarget, setRemoveTarget] = useState<PairedDevice | null>(null);

	const queryClient = useQueryClient();

	const { canScan, isScanning, startScan, cancelScan, videoRef } =
		useQrScanner();

	/** After pairing, unwrap DEKs for all known sessions and update E2EE status. */
	const unwrapAfterPairing = useCallback(() => {
		const cached = queryClient.getQueryData<SessionsResponse>(["sessions"]);
		if (!cached?.sessions) return;

		e2ee.unwrapAllSessionDeks(cached.sessions);

		const { setSessionE2EEStatus } = useChatStore.getState();
		for (const session of cached.sessions) {
			setSessionE2EEStatus(
				session.sessionId,
				e2ee.getSessionE2EEStatus(
					session.sessionId,
					Boolean(session.wrappedDek),
				),
			);
		}
	}, [queryClient]);

	const refreshDevices = useCallback(() => {
		const devices = e2ee.getPairedSecrets();
		setPairedDevices(
			devices.map((d) => ({
				secret: d.secret,
				fingerprint: d.fingerprint,
			})),
		);
	}, []);

	useEffect(() => {
		refreshDevices();
	}, [refreshDevices]);

	const handlePair = async () => {
		if (!secret.trim()) {
			setError(t("e2ee.enterSecret"));
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			await e2ee.addPairedSecret(secret.trim());
			setSecret("");
			refreshDevices();
			unwrapAfterPairing();
		} catch {
			setError(t("e2ee.invalidSecret"));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleScanQr = async () => {
		setError(null);
		try {
			const content = await startScan();
			if (!content) return; // User cancelled
			const base64Secret = parsePairingUrl(content);
			if (!base64Secret) {
				setError(t("e2ee.invalidQrCode"));
				return;
			}
			await e2ee.addPairedSecret(base64Secret);
			refreshDevices();
			unwrapAfterPairing();
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			if (errMsg.toLowerCase().includes("cancel")) return;
			if (errMsg === "camera_permission_denied") {
				setError(t("e2ee.cameraPermissionDenied"));
				return;
			}
			console.error("QR scan error:", err);
			setError(`${t("e2ee.scanError")}: ${errMsg}`);
		}
	};

	const handleRemove = async (device: PairedDevice) => {
		await e2ee.removePairedSecret(device.secret);
		setRemoveTarget(null);
		refreshDevices();
	};

	const handleRemoveAll = async () => {
		await e2ee.clearSecret();
		refreshDevices();
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2">
				<div
					className={`h-2 w-2 rounded-full ${pairedDevices.length > 0 ? "bg-green-500" : "bg-yellow-500"}`}
				/>
				<span className="text-sm font-medium">
					{pairedDevices.length > 0
						? t("e2ee.paired", { count: pairedDevices.length })
						: t("e2ee.notPaired")}
				</span>
			</div>

			{pairedDevices.length > 0 && (
				<div className="space-y-2">
					<p className="text-muted-foreground text-sm">
						{t("e2ee.pairedDevices")}
					</p>
					<div className="space-y-2">
						{pairedDevices.map((device) => (
							<div
								key={device.fingerprint}
								className="flex items-center justify-between rounded-md border p-2"
							>
								<div className="flex items-center gap-2">
									<div className="h-2 w-2 rounded-full bg-green-500" />
									<code className="text-xs">{device.fingerprint}...</code>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setRemoveTarget(device)}
								>
									{t("e2ee.remove")}
								</Button>
							</div>
						))}
					</div>
					{pairedDevices.length > 1 && (
						<Button
							variant="outline"
							size="sm"
							onClick={handleRemoveAll}
							className="w-full"
						>
							{t("e2ee.removeAll")}
						</Button>
					)}
				</div>
			)}

			<p className="text-muted-foreground text-sm">{t("e2ee.scanHint")}</p>

			{canScan && (
				<Button onClick={handleScanQr} disabled={isScanning} className="w-full">
					{isScanning ? t("e2ee.scanning") : t("e2ee.scanQrCode")}
				</Button>
			)}

			<div className="flex gap-2">
				<Input
					type="password"
					value={secret}
					onChange={(e) => setSecret(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") void handlePair();
					}}
					placeholder={t("e2ee.secretPlaceholder")}
					className="flex-1"
				/>
				<Button onClick={handlePair} disabled={isSubmitting}>
					{isSubmitting ? t("e2ee.pairing") : t("e2ee.addDevice")}
				</Button>
			</div>

			{error && <p className="text-destructive text-sm">{error}</p>}

			<AlertDialog
				open={removeTarget !== null}
				onOpenChange={(open) => !open && setRemoveTarget(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("e2ee.removeTitle")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("e2ee.removeDescription")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => removeTarget && handleRemove(removeTarget)}
						>
							{t("e2ee.remove")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{isScanning && (
				<ScannerOverlay onCancel={cancelScan} videoRef={videoRef} />
			)}
		</div>
	);
}
