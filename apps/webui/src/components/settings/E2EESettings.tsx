import { e2ee } from "@/lib/e2ee";

export function E2EESettings() {
	const isActive = e2ee.isEnabled();
	const deviceId = e2ee.getDeviceId();

	if (isActive) {
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
				E2EE keys are auto-generated when you log in. If setup failed, try
				logging out and back in.
			</p>
		</div>
	);
}
