import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
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

// This page handles the machine registration callback from CLI login flow
// The CLI opens this page in a browser, user logs in, and the page sends
// the registrationCode to the Gateway which pushes credentials to the CLI via Socket.io

export function MachineCallbackPage() {
	const [searchParams] = useSearchParams();
	const { isAuthenticated, isLoading, user } = useAuth();
	const [machineName, setMachineName] = useState("");
	const [status, setStatus] = useState<
		"pending" | "registering" | "success" | "error"
	>("pending");
	const [error, setError] = useState<string | null>(null);

	const registrationCode = searchParams.get("registrationCode");
	const gatewayUrlParam = searchParams.get("gatewayUrl");
	const hostname = searchParams.get("hostname") ?? "Unknown";
	const platform = searchParams.get("platform") ?? "unknown";
	const defaultMachineName = searchParams.get("machineName") ?? hostname;

	// Set default machine name from query param or hostname
	useEffect(() => {
		if (!machineName && defaultMachineName) {
			setMachineName(defaultMachineName);
		}
	}, [defaultMachineName, machineName]);

	const handleRegister = async () => {
		if (!registrationCode || !machineName.trim()) {
			return;
		}

		setStatus("registering");
		setError(null);

		try {
			// Use gateway URL from query params, fall back to configured URL
			const gatewayUrl =
				gatewayUrlParam ?? (import.meta.env.VITE_GATEWAY_URL as string);
			if (!gatewayUrl) {
				throw new Error("Gateway not configured");
			}

			// Call Gateway endpoint to register machine (includes registrationCode)
			// Gateway will push credentials to CLI via Socket.io
			const response = await fetch(`${gatewayUrl}/api/machines/register`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				credentials: "include",
				body: JSON.stringify({
					name: machineName.trim(),
					hostname,
					platform,
					registrationCode,
				}),
			});

			if (!response.ok) {
				const data = await response.json();
				throw new Error(data.error ?? "Failed to register machine");
			}

			// Success! Gateway has pushed credentials to CLI via Socket.io
			setStatus("success");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Registration failed");
			setStatus("error");
		}
	};

	// Show loading while checking auth
	if (isLoading) {
		return (
			<ThemeProvider>
				<div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
					<Card className="w-full max-w-md">
						<CardContent className="py-8 text-center">
							<div className="text-muted-foreground">Loading...</div>
						</CardContent>
					</Card>
				</div>
			</ThemeProvider>
		);
	}

	// Not authenticated - show login prompt
	if (!isAuthenticated) {
		return (
			<ThemeProvider>
				<div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
					<Card className="w-full max-w-md">
						<CardHeader className="text-center">
							<CardTitle>Register Machine</CardTitle>
							<CardDescription>
								Please sign in to register your machine
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="rounded-sm bg-muted p-3 text-xs">
								<div>
									<strong>Hostname:</strong> {hostname}
								</div>
								<div>
									<strong>Platform:</strong> {platform}
								</div>
							</div>
							<Button
								className="w-full"
								onClick={() => {
									// Redirect to login with return URL
									const returnUrl = window.location.href;
									window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
								}}
							>
								Sign in to continue
							</Button>
						</CardContent>
					</Card>
				</div>
			</ThemeProvider>
		);
	}

	// Success state
	if (status === "success") {
		return (
			<ThemeProvider>
				<div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
					<Card className="w-full max-w-md">
						<CardHeader className="text-center">
							<CardTitle className="text-green-600">
								Machine Registered!
							</CardTitle>
							<CardDescription>
								Your machine has been successfully registered. You can close
								this window.
							</CardDescription>
						</CardHeader>
						<CardContent className="text-center">
							<div className="rounded-sm bg-green-50 dark:bg-green-950 p-4 text-green-700 dark:text-green-300 text-sm">
								The CLI should now be connected. Return to your terminal to
								continue.
							</div>
						</CardContent>
					</Card>
				</div>
			</ThemeProvider>
		);
	}

	// Missing registration code
	if (!registrationCode) {
		return (
			<ThemeProvider>
				<div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
					<Card className="w-full max-w-md">
						<CardHeader className="text-center">
							<CardTitle className="text-destructive">
								Invalid Request
							</CardTitle>
							<CardDescription>
								This page should be opened from the mobvibe CLI login command.
							</CardDescription>
						</CardHeader>
						<CardContent className="text-center text-sm text-muted-foreground">
							<p>
								Run <code className="bg-muted px-1 rounded">mobvibe login</code>{" "}
								to register your machine.
							</p>
						</CardContent>
					</Card>
				</div>
			</ThemeProvider>
		);
	}

	// Registration form
	return (
		<ThemeProvider>
			<div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
				<Card className="w-full max-w-md">
					<CardHeader className="text-center">
						<CardTitle>Register Machine</CardTitle>
						<CardDescription>
							Connect this machine to your account: {user?.email}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="rounded-sm bg-muted p-3 text-xs">
							<div>
								<strong>Hostname:</strong> {hostname}
							</div>
							<div>
								<strong>Platform:</strong> {platform}
							</div>
						</div>

						<div className="space-y-2">
							<Label htmlFor="machineName">Machine Name</Label>
							<Input
								id="machineName"
								value={machineName}
								onChange={(e) => setMachineName(e.target.value)}
								placeholder="My Computer"
								disabled={status === "registering"}
							/>
							<p className="text-xs text-muted-foreground">
								A friendly name to identify this machine
							</p>
						</div>

						{error && (
							<div className="rounded-sm bg-destructive/10 p-3 text-destructive text-xs">
								{error}
							</div>
						)}

						<Button
							className="w-full"
							onClick={handleRegister}
							disabled={status === "registering" || !machineName.trim()}
						>
							{status === "registering" ? "Registering..." : "Register Machine"}
						</Button>
					</CardContent>
				</Card>
			</div>
		</ThemeProvider>
	);
}
