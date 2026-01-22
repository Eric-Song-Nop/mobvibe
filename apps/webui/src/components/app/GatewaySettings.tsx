import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { setApiBaseUrl } from "@/lib/api";
import { isInTauri } from "@/lib/auth";
import {
	getDefaultGatewayUrl,
	getGatewayUrl,
	setGatewayUrl,
} from "@/lib/gateway-config";
import { gatewaySocket } from "@/lib/socket";

/**
 * Gateway settings component for configuring the gateway URL in Tauri apps.
 * This component only renders when running inside Tauri.
 */
export function GatewaySettings() {
	const { t } = useTranslation();
	const [url, setUrl] = useState("");
	const [savedUrl, setSavedUrl] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Load the current gateway URL on mount
	useEffect(() => {
		if (!isInTauri()) {
			setIsLoading(false);
			return;
		}

		getGatewayUrl()
			.then((storedUrl) => {
				setUrl(storedUrl);
				setSavedUrl(storedUrl);
			})
			.catch(() => {
				const defaultUrl = getDefaultGatewayUrl();
				setUrl(defaultUrl);
				setSavedUrl(defaultUrl);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, []);

	const handleSave = useCallback(async () => {
		setIsSaving(true);
		setError(null);

		try {
			// Validate URL format
			const urlObj = new URL(url);
			if (!["http:", "https:"].includes(urlObj.protocol)) {
				throw new Error("URL must use http or https protocol");
			}

			// Save to Tauri store
			await setGatewayUrl(url);

			// Update API and socket URLs
			setApiBaseUrl(url);
			gatewaySocket.setGatewayUrl(url);

			setSavedUrl(url);
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Failed to save gateway URL",
			);
		} finally {
			setIsSaving(false);
		}
	}, [url]);

	const handleReset = useCallback(() => {
		const defaultUrl = getDefaultGatewayUrl();
		setUrl(defaultUrl);
	}, []);

	// Don't render anything outside of Tauri
	if (!isInTauri()) {
		return null;
	}

	if (isLoading) {
		return (
			<div className="p-4 text-muted-foreground">
				{t("settings.loading", "Loading...")}
			</div>
		);
	}

	const hasChanges = url !== savedUrl;

	return (
		<div className="flex flex-col gap-4 p-4">
			<Field>
				<FieldLabel htmlFor="gateway-url">
					{t("settings.gatewayUrl", "Gateway URL")}
				</FieldLabel>
				<FieldDescription>
					{t(
						"settings.gatewayUrlDescription",
						"The URL of the Mobvibe gateway server to connect to.",
					)}
				</FieldDescription>
				<Input
					id="gateway-url"
					type="url"
					value={url}
					onChange={(e) => {
						setUrl(e.target.value);
						setError(null);
					}}
					placeholder="http://localhost:3005"
				/>
				{error && <p className="text-destructive text-xs">{error}</p>}
			</Field>

			<div className="flex gap-2">
				<Button
					onClick={handleSave}
					disabled={isSaving || !hasChanges}
					size="sm"
				>
					{isSaving
						? t("settings.saving", "Saving...")
						: t("settings.save", "Save")}
				</Button>
				<Button onClick={handleReset} variant="outline" size="sm">
					{t("settings.reset", "Reset to Default")}
				</Button>
			</div>
		</div>
	);
}
