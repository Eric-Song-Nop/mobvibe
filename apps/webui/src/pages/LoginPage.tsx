import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { BrandLogo } from "@/components/brand-logo";
import { LegalLinks } from "@/components/legal/LegalLinks";
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
import { Separator } from "@/components/ui/separator";
import { getSafeAuthReturnPath, sendVerificationEmail } from "@/lib/auth";

type LoginPageProps = {
	onSuccess?: () => void;
};

type OAuthLoginProvider = "apple" | "github" | "linux-do";

export function LoginPage({ onSuccess }: LoginPageProps) {
	const { t } = useTranslation();
	const { signIn, signUp } = useAuth();
	const [searchParams] = useSearchParams();
	const returnPath = getSafeAuthReturnPath(searchParams.get("returnUrl"));
	const [mode, setMode] = useState<"login" | "register">("login");
	const [isLoading, setIsLoading] = useState(false);
	const [providerLoading, setProviderLoading] =
		useState<OAuthLoginProvider | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showVerificationMessage, setShowVerificationMessage] = useState(false);
	const [resendingEmail, setResendingEmail] = useState(false);
	const [resendCooldown, setResendCooldown] = useState(0);
	const [emailVerifiedSuccess, setEmailVerifiedSuccess] = useState(false);
	const [formData, setFormData] = useState({
		email: "",
		password: "",
		name: "",
	});
	const isBusy = isLoading || providerLoading !== null;

	const oauthProviders: Array<{ id: OAuthLoginProvider; label: string }> = [
		{
			id: "apple",
			label: t("auth.providers.apple"),
		},
		{
			id: "github",
			label: t("auth.providers.github"),
		},
		{
			id: "linux-do",
			label: t("auth.providers.linuxDo"),
		},
	];

	// Handle ?verified=1 URL param
	useEffect(() => {
		if (searchParams.get("verified") === "1") {
			setEmailVerifiedSuccess(true);
		}
	}, [searchParams]);

	// Countdown timer for resend cooldown
	useEffect(() => {
		if (resendCooldown <= 0) return;
		const timer = setInterval(() => {
			setResendCooldown((prev) => Math.max(0, prev - 1));
		}, 1000);
		return () => clearInterval(timer);
	}, [resendCooldown]);

	const handleSubmit = async (event: React.FormEvent) => {
		event.preventDefault();
		setError(null);
		setShowVerificationMessage(false);
		setIsLoading(true);

		try {
			if (mode === "login") {
				const result = await signIn.email({
					email: formData.email,
					password: formData.password,
				});
				if (result.error) {
					// Check if error is due to email not verified
					if (result.error.status === 403) {
						setShowVerificationMessage(true);
						setError(t("auth.emailNotVerified"));
					} else {
						setError(result.error.message ?? t("auth.loginFailed"));
					}
					return;
				}
				onSuccess?.();
			} else {
				const result = await signUp.email({
					email: formData.email,
					password: formData.password,
					name: formData.name || formData.email.split("@")[0],
				});
				if (result.error) {
					setError(result.error.message ?? t("auth.registrationFailed"));
					return;
				}
				// Show verification message after successful registration
				setShowVerificationMessage(true);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t("auth.errorOccurred"));
		} finally {
			setIsLoading(false);
		}
	};

	const handleOAuthSignIn = async (provider: OAuthLoginProvider) => {
		setError(null);
		setShowVerificationMessage(false);
		setProviderLoading(provider);

		try {
			const result =
				provider === "linux-do"
					? await signIn.oauth2({
							providerId: "linux-do",
							returnPath,
						})
					: await signIn.social({
							provider,
							returnPath,
						});
			if (result.error) {
				setError(result.error.message ?? t("auth.loginFailed"));
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t("auth.errorOccurred"));
		} finally {
			setProviderLoading(null);
		}
	};

	const handleResendVerification = async () => {
		setResendingEmail(true);
		setError(null);

		try {
			const result = await sendVerificationEmail({ email: formData.email });
			if (result.error) {
				setError(result.error.message ?? t("auth.resendFailed"));
			} else {
				// Set 60s cooldown on success
				setResendCooldown(60);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : t("auth.resendFailed"));
		} finally {
			setResendingEmail(false);
		}
	};

	return (
		<div className="flex min-h-dvh items-center justify-center bg-muted/40 p-4">
			<Card className="w-full max-w-md">
				<CardHeader className="text-center">
					<div className="flex justify-center mb-2">
						<BrandLogo
							alt={t("common.appName")}
							className="size-12"
							fetchPriority="high"
						/>
					</div>
					<CardTitle className="text-xl">
						{mode === "login" ? t("auth.signIn") : t("auth.createAccount")}
					</CardTitle>
					<CardDescription>
						{mode === "login"
							? t("auth.signInDescription")
							: t("auth.createAccountDescription")}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="space-y-3">
						<div className="grid gap-2 sm:grid-cols-3">
							{oauthProviders.map((provider) => (
								<Button
									key={provider.id}
									type="button"
									variant="outline"
									className="w-full justify-center"
									disabled={isBusy}
									onClick={() => handleOAuthSignIn(provider.id)}
								>
									{providerLoading === provider.id
										? t("auth.loading")
										: t("auth.continueWithProvider", {
												provider: provider.label,
											})}
								</Button>
							))}
						</div>
						<div className="flex items-center gap-3 text-[11px] text-muted-foreground">
							<Separator className="flex-1" />
							<span>{t("auth.orContinueWith")}</span>
							<Separator className="flex-1" />
						</div>
					</div>
					<form onSubmit={handleSubmit} className="space-y-4">
						{mode === "register" && (
							<div className="space-y-2">
								<Label htmlFor="name">{t("auth.name")}</Label>
								<Input
									id="name"
									name="name"
									autoComplete="name"
									type="text"
									placeholder={t("auth.namePlaceholder")}
									value={formData.name}
									onChange={(e) =>
										setFormData({ ...formData, name: e.target.value })
									}
									disabled={isBusy}
								/>
							</div>
						)}
						<div className="space-y-2">
							<Label htmlFor="email">{t("auth.email")}</Label>
							<Input
								id="email"
								name="email"
								autoComplete="email"
								spellCheck={false}
								type="email"
								placeholder={t("auth.emailPlaceholder")}
								value={formData.email}
								onChange={(e) =>
									setFormData({ ...formData, email: e.target.value })
								}
								required
								disabled={isBusy}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">{t("auth.password")}</Label>
							<Input
								id="password"
								name="password"
								autoComplete={
									mode === "login" ? "current-password" : "new-password"
								}
								type="password"
								placeholder={t("auth.passwordPlaceholder")}
								value={formData.password}
								onChange={(e) =>
									setFormData({ ...formData, password: e.target.value })
								}
								required
								disabled={isBusy}
								minLength={8}
							/>
						</div>

						{emailVerifiedSuccess && (
							<output
								aria-live="polite"
								className="rounded-sm bg-green-500/10 p-3 text-green-600 dark:text-green-400 text-xs"
							>
								{t("auth.emailVerified")}
							</output>
						)}

						{error && (
							<div
								role="alert"
								className="rounded-sm bg-destructive/10 p-3 text-destructive text-xs"
							>
								{error}
							</div>
						)}

						{showVerificationMessage && (
							<output
								aria-live="polite"
								className="rounded-sm bg-primary/10 p-3 text-primary text-xs"
							>
								{mode === "register"
									? t("auth.verificationEmailSent")
									: t("auth.pleaseVerifyEmail")}
								<Button
									type="button"
									variant="link"
									size="sm"
									className="h-auto p-0 ml-1"
									onClick={handleResendVerification}
									disabled={isBusy || resendingEmail || resendCooldown > 0}
								>
									{resendingEmail
										? t("auth.resending")
										: resendCooldown > 0
											? t("auth.resendCooldown", { seconds: resendCooldown })
											: t("auth.resendVerification")}
								</Button>
							</output>
						)}

						<Button type="submit" className="w-full" disabled={isBusy}>
							{isLoading
								? t("auth.loading")
								: mode === "login"
									? t("auth.signIn")
									: t("auth.createAccount")}
						</Button>
					</form>
				</CardContent>
				<CardFooter className="flex-col items-center gap-3">
					<p className="text-center text-xs text-muted-foreground">
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
					<div className="w-full border-t pt-3">
						<p className="mb-2 text-center text-[11px] text-muted-foreground">
							{t("legal.loginNote")}
						</p>
						<LegalLinks className="justify-center gap-x-4 gap-y-2" />
					</div>
				</CardFooter>
			</Card>
		</div>
	);
}
