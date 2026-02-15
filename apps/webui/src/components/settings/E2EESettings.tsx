import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { e2ee } from "@/lib/e2ee";
import { isMobilePlatform } from "@/lib/platform";

/**
 * Convert a base64url string back to standard base64.
 */
function base64urlToBase64(base64url: string): string {
	let b64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
	// Re-add padding
	const pad = b64.length % 4;
	if (pad === 2) b64 += "==";
	else if (pad === 3) b64 += "=";
	return b64;
}

/**
 * Parse a `mobvibe://pair?secret=<base64url>` URL and return the standard base64 secret.
 * Returns null if the URL doesn't match the expected format.
 */
export function parsePairingUrl(url: string): string | null {
	try {
		// Handle both mobvibe://pair?secret=... and mobvibe://pair/?secret=...
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
	const [isPaired, setIsPaired] = useState(e2ee.isEnabled());
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isMobile, setIsMobile] = useState(false);
	const [isScanning, setIsScanning] = useState(false);
	const [showLegacyPairing, setShowLegacyPairing] = useState(false);
	const deviceId = e2ee.getDeviceId();

	useEffect(() => {
		isMobilePlatform().then(setIsMobile);
	}, []);

	const handlePair = async () => {
		if (!secret.trim()) {
			setError("Please enter a master secret.");
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			await e2ee.setPairedSecret(secret.trim());
			setIsPaired(true);
			setSecret("");
		} catch {
			setError("Invalid master secret. Please check and try again.");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleScanQr = async () => {
		setIsScanning(true);
		setError(null);

		try {
			const { scan, Format } = await import(
				"@tauri-apps/plugin-barcode-scanner"
			);
			const result = await scan({ windowed: false, formats: [Format.QRCode] });

			const base64Secret = parsePairingUrl(result.content);
			if (!base64Secret) {
				setError(t("e2ee.invalidQrCode"));
				return;
			}

			await e2ee.setPairedSecret(base64Secret);
			setIsPaired(true);
		} catch {
			setError(t("e2ee.scanError"));
		} finally {
			setIsScanning(false);
		}
	};

	const handleUnpair = async () => {
		await e2ee.clearSecret();
		setIsPaired(false);
	};

	if (isPaired) {
		return (
			<div className="space-y-3">
				<div className="flex items-center gap-2">
					<div className="h-2 w-2 rounded-full bg-green-500" />
					<span className="text-sm font-medium">E2EE Active</span>
				</div>
				<p className="text-muted-foreground text-sm">
					End-to-end encryption is active. Session content is decrypted locally.
					{deviceId && (
						<>
							<br />
							Device ID:{" "}
							<code className="text-xs">{deviceId.slice(0, 8)}...</code>
						</>
					)}
				</p>
				<Button variant="destructive" onClick={handleUnpair}>
					Unpair
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-2">
				<div className="h-2 w-2 rounded-full bg-yellow-500" />
				<span className="text-sm font-medium">E2EE Not Active</span>
			</div>
			<p className="text-muted-foreground text-sm">
				E2EE keys are auto-generated for this device. If auto-setup failed, you
				can manually pair with a CLI master secret below.
			</p>
			{!showLegacyPairing && (
				<Button
					variant="outline"
					onClick={() => setShowLegacyPairing(true)}
					className="w-full"
				>
					Manual Pairing (Legacy)
				</Button>
			)}
			{showLegacyPairing && (
				<>
					<p className="text-muted-foreground text-sm">
						{isMobile
							? t("e2ee.scanHint")
							: `Paste the master secret from your CLI. Run \`mobvibe e2ee show\` to get your secret.`}
					</p>
					{isMobile && (
						<Button
							onClick={handleScanQr}
							disabled={isScanning}
							className="w-full"
						>
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
							placeholder="Paste master secret (base64)"
							className="flex-1"
						/>
						<Button onClick={handlePair} disabled={isSubmitting}>
							{isSubmitting ? "Pairing..." : "Pair"}
						</Button>
					</div>
				</>
			)}
			{error && <p className="text-destructive text-sm">{error}</p>}
		</div>
	);
}
