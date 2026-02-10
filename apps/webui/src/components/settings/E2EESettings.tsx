import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { e2ee } from "@/lib/e2ee";

export function E2EESettings() {
	const [secret, setSecret] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [isPaired, setIsPaired] = useState(e2ee.isEnabled());
	const [isSubmitting, setIsSubmitting] = useState(false);

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

	const handleUnpair = async () => {
		await e2ee.clearSecret();
		setIsPaired(false);
	};

	if (isPaired) {
		return (
			<div className="space-y-3">
				<div className="flex items-center gap-2">
					<div className="h-2 w-2 rounded-full bg-green-500" />
					<span className="text-sm font-medium">E2EE Paired</span>
				</div>
				<p className="text-muted-foreground text-sm">
					End-to-end encryption is active. Session content is decrypted locally.
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
				<span className="text-sm font-medium">E2EE Not Paired</span>
			</div>
			<p className="text-muted-foreground text-sm">
				Paste the master secret from your CLI to enable end-to-end encryption.
				Run <code className="bg-muted rounded px-1">mobvibe e2ee show</code> to
				get your secret.
			</p>
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
			{error && <p className="text-destructive text-sm">{error}</p>}
		</div>
	);
}
