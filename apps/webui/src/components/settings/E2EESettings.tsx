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
import { e2ee } from "@/lib/e2ee";
import { isMobilePlatform } from "@/lib/platform";

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

export function E2EESettings() {
	const { t } = useTranslation();
	const [secret, setSecret] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const [isScanning, setIsScanning] = useState(false);
	const [removeTarget, setRemoveTarget] = useState<PairedDevice | null>(null);

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
		isMobilePlatform().then(setIsMobile);
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
		} catch {
			setError(t("e2ee.invalidSecret"));
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleScanQr = async () => {
		setIsScanning(true);
		setError(null);

		try {
			const { scan, Format, checkPermissions, requestPermissions } =
				await import("@tauri-apps/plugin-barcode-scanner");

			let permState = await checkPermissions();
			if (permState === "prompt") {
				permState = await requestPermissions();
			}
			if (permState !== "granted") {
				setError(t("e2ee.cameraPermissionDenied"));
				return;
			}

			const result = await scan({ formats: [Format.QRCode] });
			if (!result?.content) {
				setError(t("e2ee.scanError"));
				return;
			}

			const base64Secret = parsePairingUrl(result.content);
			if (!base64Secret) {
				setError(t("e2ee.invalidQrCode"));
				return;
			}

			await e2ee.addPairedSecret(base64Secret);
			refreshDevices();
		} catch (err) {
			console.error("QR scan error:", err);
			const errMsg = err instanceof Error ? err.message : String(err);
			setError(`${t("e2ee.scanError")}: ${errMsg}`);
		} finally {
			setIsScanning(false);
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

			<p className="text-muted-foreground text-sm">
				{isMobile ? t("e2ee.scanHint") : t("e2ee.pasteHint")}
			</p>

			{isMobile && (
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
		</div>
	);
}
