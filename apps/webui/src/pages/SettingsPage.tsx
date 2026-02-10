import { ArrowLeft02Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { E2EESettings } from "@/components/settings/E2EESettings";
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
import { changePassword } from "@/lib/auth";

export function SettingsPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { isAuthenticated, isLoading: authLoading } = useAuth();
	const [error, setError] = useState<string | null>(null);
	const [success, setSuccess] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [formData, setFormData] = useState({
		currentPassword: "",
		newPassword: "",
		confirmPassword: "",
	});

	const handleChangePassword = async (e: React.FormEvent) => {
		e.preventDefault();
		setError(null);
		setSuccess(null);

		// Validate passwords match
		if (formData.newPassword !== formData.confirmPassword) {
			setError(t("settings.passwordMismatch"));
			return;
		}

		// Validate password length
		if (formData.newPassword.length < 8) {
			setError(t("settings.passwordTooShort"));
			return;
		}

		setIsSubmitting(true);

		try {
			const result = await changePassword({
				currentPassword: formData.currentPassword,
				newPassword: formData.newPassword,
			});

			if (result.error) {
				setError(result.error.message ?? t("settings.changePasswordFailed"));
				return;
			}

			setSuccess(t("settings.passwordChanged"));
			setFormData({
				currentPassword: "",
				newPassword: "",
				confirmPassword: "",
			});
		} catch (err) {
			setError(
				err instanceof Error ? err.message : t("settings.changePasswordFailed"),
			);
		} finally {
			setIsSubmitting(false);
		}
	};

	if (authLoading) {
		return (
			<ThemeProvider>
				<div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
					<div className="text-muted-foreground">{t("common.loading")}</div>
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
						<HugeiconsIcon
							icon={ArrowLeft02Icon}
							className="mr-2 h-4 w-4"
							aria-hidden="true"
						/>
						{t("common.back")}
					</Button>

					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<HugeiconsIcon
									icon={Settings02Icon}
									className="h-5 w-5"
									aria-hidden="true"
								/>
								{t("settings.title")}
							</CardTitle>
							<CardDescription>{t("settings.description")}</CardDescription>
						</CardHeader>
						<CardContent>
							{/* Password Change Section */}
							<div className="rounded-lg border bg-card p-4">
								<h3 className="mb-3 font-medium">
									{t("settings.changePassword")}
								</h3>
								<form onSubmit={handleChangePassword} className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="currentPassword">
											{t("settings.currentPassword")}
										</Label>
										<Input
											id="currentPassword"
											name="current-password"
											autoComplete="current-password"
											type="password"
											value={formData.currentPassword}
											onChange={(e) =>
												setFormData({
													...formData,
													currentPassword: e.target.value,
												})
											}
											required
											disabled={isSubmitting}
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="newPassword">
											{t("settings.newPassword")}
										</Label>
										<Input
											id="newPassword"
											name="new-password"
											autoComplete="new-password"
											type="password"
											value={formData.newPassword}
											onChange={(e) =>
												setFormData({
													...formData,
													newPassword: e.target.value,
												})
											}
											required
											disabled={isSubmitting}
											minLength={8}
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="confirmPassword">
											{t("settings.confirmPassword")}
										</Label>
										<Input
											id="confirmPassword"
											name="confirm-password"
											autoComplete="new-password"
											type="password"
											value={formData.confirmPassword}
											onChange={(e) =>
												setFormData({
													...formData,
													confirmPassword: e.target.value,
												})
											}
											required
											disabled={isSubmitting}
											minLength={8}
										/>
									</div>

									{error && (
										<div
											className="rounded-sm bg-destructive/10 p-3 text-destructive text-sm"
											aria-live="polite"
										>
											{error}
										</div>
									)}

									{success && (
										<div
											className="rounded-sm bg-green-500/10 p-3 text-green-600 dark:text-green-400 text-sm"
											aria-live="polite"
										>
											{success}
										</div>
									)}

									<Button type="submit" disabled={isSubmitting}>
										{isSubmitting
											? t("common.loading")
											: t("settings.updatePassword")}
									</Button>
								</form>
							</div>
						</CardContent>
					</Card>

					{/* E2EE Section */}
					<Card className="mt-4">
						<CardHeader>
							<CardTitle>End-to-End Encryption</CardTitle>
							<CardDescription>
								Pair this device with your CLI to decrypt session content.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="rounded-lg border bg-card p-4">
								<E2EESettings />
							</div>
						</CardContent>
					</Card>
				</div>
			</div>
		</ThemeProvider>
	);
}
