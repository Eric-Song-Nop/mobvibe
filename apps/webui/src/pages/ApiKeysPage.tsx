import {
	Add01Icon,
	ArrowLeft02Icon,
	CheckmarkSquare01Icon,
	Copy01Icon,
	Delete02Icon,
	Key01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { ThemeProvider } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ApiKeyData, apiKey } from "@/lib/auth";

type ApiKeyWithKey = ApiKeyData & { key?: string };

export function ApiKeysPage() {
	const navigate = useNavigate();
	const { isAuthenticated, isLoading: authLoading } = useAuth();
	const [apiKeys, setApiKeys] = useState<ApiKeyData[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [showCreateForm, setShowCreateForm] = useState(false);
	const [newKeyName, setNewKeyName] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [newlyCreatedKey, setNewlyCreatedKey] = useState<ApiKeyWithKey | null>(
		null,
	);
	const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
	const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);

	const loadApiKeys = useCallback(async () => {
		try {
			setIsLoading(true);
			setError(null);
			const result = await apiKey.list();
			if (result.error) {
				setError(result.error.message ?? "Failed to load API keys");
				return;
			}
			setApiKeys(result.data ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load API keys");
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		if (isAuthenticated) {
			loadApiKeys();
		}
	}, [isAuthenticated, loadApiKeys]);

	const handleCreateKey = async () => {
		setIsCreating(true);
		setError(null);

		try {
			const result = await apiKey.create({
				name: newKeyName.trim() || undefined,
			});

			if (result.error) {
				setError(result.error.message ?? "Failed to create API key");
				return;
			}

			setNewlyCreatedKey(result.data ?? null);
			setShowCreateForm(false);
			setNewKeyName("");
			await loadApiKeys();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create API key");
		} finally {
			setIsCreating(false);
		}
	};

	const handleRevokeKey = async (keyId: string) => {
		setDeletingKeyId(keyId);
		setError(null);

		try {
			const result = await apiKey.delete({ keyId });

			if (result.error) {
				setError(result.error.message ?? "Failed to revoke API key");
				return;
			}

			await loadApiKeys();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to revoke API key");
		} finally {
			setDeletingKeyId(null);
		}
	};

	const handleCopyKey = async (key: string, keyId: string) => {
		try {
			await navigator.clipboard.writeText(key);
			setCopiedKeyId(keyId);
			setTimeout(() => setCopiedKeyId(null), 2000);
		} catch {
			setError("Failed to copy to clipboard");
		}
	};

	if (authLoading) {
		return (
			<ThemeProvider>
				<div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
					<div className="text-muted-foreground">Loading...</div>
				</div>
			</ThemeProvider>
		);
	}

	if (!isAuthenticated) {
		navigate("/login");
		return null;
	}

	return (
		<ThemeProvider>
			<div className="min-h-screen bg-muted/40 p-4">
				<div className="mx-auto max-w-2xl">
					<Button
						variant="ghost"
						size="sm"
						className="mb-4"
						onClick={() => navigate("/")}
					>
						<HugeiconsIcon icon={ArrowLeft02Icon} className="mr-2 h-4 w-4" />
						Back
					</Button>

					<Card>
						<CardHeader>
							<div className="flex items-center justify-between">
								<div>
									<CardTitle className="flex items-center gap-2">
										<HugeiconsIcon icon={Key01Icon} className="h-5 w-5" />
										API Keys
									</CardTitle>
									<CardDescription>
										Create API keys to authenticate the CLI with your account
									</CardDescription>
								</div>
								{!showCreateForm && !newlyCreatedKey && (
									<Button onClick={() => setShowCreateForm(true)}>
										<HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
										Create Key
									</Button>
								)}
							</div>
						</CardHeader>
						<CardContent>
							{error && (
								<div className="mb-4 rounded-sm bg-destructive/10 p-3 text-destructive text-sm">
									{error}
								</div>
							)}

							{/* Newly created key display */}
							{newlyCreatedKey && (
								<div className="mb-4 rounded-lg border border-green-500/50 bg-green-50 dark:bg-green-950/20 p-4">
									<h3 className="mb-2 font-medium text-green-700 dark:text-green-300">
										API Key Created
									</h3>
									<p className="mb-3 text-sm text-green-600 dark:text-green-400">
										Copy your API key now. You won't be able to see it again!
									</p>
									<div className="flex items-center gap-2">
										<code className="flex-1 rounded bg-white dark:bg-black/50 p-3 text-sm font-mono break-all border">
											{newlyCreatedKey.key}
										</code>
										<Button
											variant="outline"
											size="icon"
											onClick={() => {
												if (newlyCreatedKey.key) {
													handleCopyKey(
														newlyCreatedKey.key,
														newlyCreatedKey.id,
													);
												}
											}}
										>
											{copiedKeyId === newlyCreatedKey.id ? (
												<HugeiconsIcon
													icon={CheckmarkSquare01Icon}
													className="h-4 w-4 text-green-500"
												/>
											) : (
												<HugeiconsIcon icon={Copy01Icon} className="h-4 w-4" />
											)}
										</Button>
									</div>
									<p className="mt-3 text-sm text-muted-foreground">
										Run{" "}
										<code className="rounded bg-muted px-1">mobvibe login</code>{" "}
										and paste this key when prompted.
									</p>
									<Button
										variant="outline"
										size="sm"
										className="mt-3"
										onClick={() => setNewlyCreatedKey(null)}
									>
										Done
									</Button>
								</div>
							)}

							{/* Create key form */}
							{showCreateForm && (
								<div className="mb-4 rounded-lg border bg-card p-4">
									<h3 className="mb-3 font-medium">Create API Key</h3>
									<div className="space-y-3">
										<div className="space-y-2">
											<Label htmlFor="keyName">Key Name (optional)</Label>
											<Input
												id="keyName"
												placeholder="My CLI Key"
												value={newKeyName}
												onChange={(e) => setNewKeyName(e.target.value)}
											/>
											<p className="text-xs text-muted-foreground">
												A friendly name to identify this key
											</p>
										</div>
										<div className="flex gap-2">
											<Button
												variant="outline"
												onClick={() => {
													setShowCreateForm(false);
													setNewKeyName("");
												}}
											>
												Cancel
											</Button>
											<Button onClick={handleCreateKey} disabled={isCreating}>
												{isCreating ? "Creating..." : "Create Key"}
											</Button>
										</div>
									</div>
								</div>
							)}

							{isLoading ? (
								<div className="py-8 text-center text-muted-foreground">
									Loading...
								</div>
							) : apiKeys.length === 0 ? (
								<div className="py-8 text-center text-muted-foreground">
									<HugeiconsIcon
										icon={Key01Icon}
										className="mx-auto mb-2 h-8 w-8 opacity-50"
									/>
									<p>No API keys yet</p>
									<p className="text-sm">
										Create an API key to use with the mobvibe CLI
									</p>
								</div>
							) : (
								<div className="space-y-3">
									{apiKeys.map((key) => (
										<div
											key={key.id}
											className="flex items-center justify-between rounded-lg border bg-card p-3"
										>
											<div className="min-w-0 flex-1">
												<div className="font-medium">
													{key.name ?? "Unnamed key"}
												</div>
												<div className="text-sm text-muted-foreground">
													{key.start}...
												</div>
												<div className="text-xs text-muted-foreground">
													Created {new Date(key.createdAt).toLocaleDateString()}
													{key.expiresAt && (
														<>
															{" "}
															· Expires{" "}
															{new Date(key.expiresAt).toLocaleDateString()}
														</>
													)}
												</div>
											</div>
											<Button
												variant="ghost"
												size="icon"
												className="text-destructive hover:text-destructive"
												onClick={() => handleRevokeKey(key.id)}
												disabled={deletingKeyId === key.id}
											>
												<HugeiconsIcon
													icon={Delete02Icon}
													className="h-4 w-4"
												/>
											</Button>
										</div>
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</div>
			</div>
		</ThemeProvider>
	);
}
