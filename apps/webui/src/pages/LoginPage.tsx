import { signInSocial } from "@daveyplate/better-auth-tauri";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuthClient, isInTauri } from "@/lib/auth";

type LoginPageProps = {
	onSuccess?: () => void;
};

export function LoginPage({ onSuccess }: LoginPageProps) {
	const { t } = useTranslation();
	const { signIn, signUp } = useAuth();
	const [mode, setMode] = useState<"login" | "register">("login");
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [formData, setFormData] = useState({
		email: "",
		password: "",
		name: "",
	});

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setIsLoading(true);

		try {
			if (mode === "login") {
				const result = await signIn.email({
					email: formData.email,
					password: formData.password,
				});
				if (result.error) {
					setError(result.error.message ?? "Login failed");
					return;
				}
			} else {
				const result = await signUp.email({
					email: formData.email,
					password: formData.password,
					name: formData.name || formData.email.split("@")[0],
				});
				if (result.error) {
					setError(result.error.message ?? "Registration failed");
					return;
				}
			}
			onSuccess?.();
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsLoading(false);
		}
	};

	const handleSocialLogin = async () => {
		setError(null);
		setIsLoading(true);

		try {
			if (isInTauri()) {
				const authClient = getAuthClient();
				if (!authClient) {
					throw new Error("Auth not configured");
				}
				await signInSocial({
					authClient,
					provider: "github",
				});
			} else {
				await signIn.social({ provider: "github" });
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Social login failed");
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<CardTitle className="text-xl">
						{mode === "login" ? t("auth.signIn") : t("auth.createAccount")}
					</CardTitle>
					<CardDescription>
						{mode === "login"
							? t("auth.signInDescription")
							: t("auth.createAccountDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form onSubmit={handleSubmit} className="space-y-4">
						{mode === "register" && (
							<div className="space-y-2">
								<Label htmlFor="name">{t("auth.name")}</Label>
								<Input
									id="name"
									type="text"
									placeholder={t("auth.namePlaceholder")}
									value={formData.name}
									onChange={(e) =>
										setFormData({ ...formData, name: e.target.value })
									}
									disabled={isLoading}
								/>
							</div>
						)}
						<div className="space-y-2">
							<Label htmlFor="email">{t("auth.email")}</Label>
							<Input
								id="email"
								type="email"
								placeholder={t("auth.emailPlaceholder")}
								value={formData.email}
								onChange={(e) =>
									setFormData({ ...formData, email: e.target.value })
								}
								required
								disabled={isLoading}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">{t("auth.password")}</Label>
							<Input
								id="password"
								type="password"
								placeholder={t("auth.passwordPlaceholder")}
								value={formData.password}
								onChange={(e) =>
									setFormData({ ...formData, password: e.target.value })
								}
								required
								disabled={isLoading}
								minLength={8}
							/>
						</div>

						{error && (
							<div className="rounded-sm bg-destructive/10 p-3 text-destructive text-xs">
								{error}
							</div>
						)}

						<Button type="submit" className="w-full" disabled={isLoading}>
							{isLoading
								? t("auth.loading")
								: mode === "login"
									? t("auth.signIn")
									: t("auth.createAccount")}
						</Button>
					</form>

					<div className="relative my-4">
						<div className="absolute inset-0 flex items-center">
							<div className="w-full border-t border-border" />
						</div>
						<div className="relative flex justify-center text-xs uppercase">
							<span className="bg-card px-2 text-muted-foreground">
								{t("auth.orContinueWith")}
							</span>
						</div>
					</div>

					<div className="grid gap-3">
						<Button
							type="button"
							variant="outline"
							onClick={handleSocialLogin}
							disabled={isLoading}
						>
							<svg
								className="mr-2 h-4 w-4"
								viewBox="0 0 24 24"
								fill="currentColor"
							>
								<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
							</svg>
							GitHub
						</Button>
					</div>
				</CardContent>
				<CardFooter className="justify-center">
					<p className="text-xs text-muted-foreground">
						{mode === "login" ? (
							<>
								{t("auth.noAccount")}{" "}
								<button
									type="button"
									className="text-primary hover:underline"
									onClick={() => setMode("register")}
								>
									{t("auth.createAccount")}
								</button>
							</>
						) : (
							<>
								{t("auth.haveAccount")}{" "}
								<button
									type="button"
									className="text-primary hover:underline"
									onClick={() => setMode("login")}
								>
									{t("auth.signIn")}
								</button>
							</>
						)}
					</p>
				</CardFooter>
			</Card>
		</div>
	);
}
