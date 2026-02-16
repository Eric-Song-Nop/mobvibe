import { Delete02Icon, Edit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	type DeviceInfo,
	deleteDevice,
	fetchDevices,
	getApiBaseUrl,
	renameDeviceApi,
} from "@/lib/api";
import { e2ee } from "@/lib/e2ee";

export function E2EESettings() {
	const [isEnabled, setIsEnabled] = useState(e2ee.isEnabled());
	const [devices, setDevices] = useState<DeviceInfo[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
	const [editName, setEditName] = useState("");
	const [registering, setRegistering] = useState(false);

	const currentDeviceId = e2ee.getDeviceId();

	const loadDevices = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await fetchDevices();
			setDevices(response.devices);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load devices");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (isEnabled) {
			loadDevices();
		}
	}, [isEnabled, loadDevices]);

	const handleReset = async () => {
		await e2ee.clearSecret();
		setIsEnabled(false);
		setDevices([]);
	};

	const handleRegister = async () => {
		setRegistering(true);
		setError(null);
		try {
			const gatewayUrl = getApiBaseUrl();
			const success = await e2ee.reRegister(gatewayUrl);
			if (success) {
				setIsEnabled(true);
				await loadDevices();
			} else {
				setError("Failed to register device");
			}
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to register device",
			);
		} finally {
			setRegistering(false);
		}
	};

	const handleDeleteDevice = async (deviceId: string) => {
		if (deviceId === currentDeviceId) {
			setError("Cannot delete the current device. Use 'Reset Keys' instead.");
			return;
		}

		if (!confirm("Are you sure you want to remove this device?")) {
			return;
		}

		try {
			await deleteDevice(deviceId);
			await loadDevices();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to delete device");
		}
	};

	const handleStartEdit = (device: DeviceInfo) => {
		setEditingDeviceId(device.id);
		setEditName(device.deviceName || "");
	};

	const handleCancelEdit = () => {
		setEditingDeviceId(null);
		setEditName("");
	};

	const handleSaveEdit = async (deviceId: string) => {
		if (!editName.trim()) {
			return;
		}

		try {
			await renameDeviceApi(deviceId, editName.trim());
			await loadDevices();
			setEditingDeviceId(null);
			setEditName("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to rename device");
		}
	};

	const formatDate = (dateStr: string | null) => {
		if (!dateStr) return "Never";
		return new Date(dateStr).toLocaleDateString();
	};

	if (!isEnabled) {
		return (
			<div className="space-y-4">
				<div className="flex items-center gap-2">
					<div className="h-2 w-2 rounded-full bg-yellow-500" />
					<span className="text-sm font-medium">E2EE Not Enabled</span>
				</div>
				<p className="text-muted-foreground text-sm">
					E2EE will be automatically initialized when you connect to the
					gateway.
				</p>
				<Button onClick={handleRegister} disabled={registering}>
					{registering ? "Registering..." : "Register Device"}
				</Button>
				{error && <p className="text-destructive text-sm">{error}</p>}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2">
				<div className="h-2 w-2 rounded-full bg-green-500" />
				<span className="text-sm font-medium">E2EE Enabled</span>
			</div>
			<p className="text-muted-foreground text-sm">
				End-to-end encryption is active. Session content is decrypted locally.
			</p>

			{error && (
				<p className="text-destructive text-sm bg-destructive/10 p-2 rounded">
					{error}
				</p>
			)}

			<div className="space-y-2">
				<h4 className="text-sm font-medium">Registered Devices</h4>
				{loading ? (
					<p className="text-muted-foreground text-sm">Loading devices...</p>
				) : devices.length === 0 ? (
					<p className="text-muted-foreground text-sm">
						No devices registered.
					</p>
				) : (
					<div className="space-y-2">
						{devices.map((device) => {
							const isCurrentDevice = device.id === currentDeviceId;
							const isEditing = editingDeviceId === device.id;

							return (
								<div
									key={device.id}
									className={`flex items-center justify-between p-3 rounded-lg border ${
										isCurrentDevice
											? "bg-primary/5 border-primary/20"
											: "bg-card"
									}`}
								>
									<div className="flex-1 min-w-0">
										{isEditing ? (
											<div className="flex items-center gap-2">
												<Input
													value={editName}
													onChange={(e) => setEditName(e.target.value)}
													className="h-8 w-48"
													placeholder="Device name"
												/>
												<Button
													size="sm"
													onClick={() => handleSaveEdit(device.id)}
												>
													Save
												</Button>
												<Button
													size="sm"
													variant="ghost"
													onClick={handleCancelEdit}
												>
													Cancel
												</Button>
											</div>
										) : (
											<>
												<div className="flex items-center gap-2">
													<span className="font-medium text-sm truncate">
														{device.deviceName || "Unknown Device"}
													</span>
													{isCurrentDevice && (
														<span className="text-xs bg-primary/20 text-primary px-2 py-0.5 rounded">
															This device
														</span>
													)}
													{!device.hasContentKey && (
														<span className="text-xs bg-yellow-500/20 text-yellow-600 px-2 py-0.5 rounded">
															No content key
														</span>
													)}
												</div>
												<div className="text-muted-foreground text-xs mt-1">
													Created: {formatDate(device.createdAt)} • Last seen:{" "}
													{formatDate(device.lastSeenAt)}
												</div>
											</>
										)}
									</div>
									{!isEditing && (
										<div className="flex items-center gap-1">
											<Button
												size="icon"
												variant="ghost"
												className="h-8 w-8"
												onClick={() => handleStartEdit(device)}
												title="Rename device"
											>
												<HugeiconsIcon icon={Edit02Icon} className="h-4 w-4" />
											</Button>
											{!isCurrentDevice && (
												<Button
													size="icon"
													variant="ghost"
													className="h-8 w-8 text-destructive hover:text-destructive"
													onClick={() => handleDeleteDevice(device.id)}
													title="Remove device"
												>
													<HugeiconsIcon
														icon={Delete02Icon}
														className="h-4 w-4"
													/>
												</Button>
											)}
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			<div className="flex gap-2 pt-2">
				<Button
					variant="outline"
					onClick={handleRegister}
					disabled={registering}
				>
					{registering ? "Re-registering..." : "Re-register Device"}
				</Button>
				<Button variant="destructive" onClick={handleReset}>
					Reset Keys
				</Button>
			</div>
		</div>
	);
}
