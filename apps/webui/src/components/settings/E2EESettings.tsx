import { useState } from "react";
import { Button } from "@/components/ui/button";
import { e2ee } from "@/lib/e2ee";

export function E2EESettings() {
	const [isPaired, setIsPaired] = useState(e2ee.isEnabled());

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
				E2EE will be automatically initialized when you connect to the gateway.
			</p>
		</div>
	);
}
