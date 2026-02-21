import {
	ArrowLeft02Icon,
	ComputerIcon,
	LockKeyIcon,
	MoonIcon,
	PaintBoardIcon,
	Settings02Icon,
	SunIcon,
	UserAccountIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { E2EESettings } from "@/components/settings/E2EESettings";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
} from "@/components/ui/sidebar";
import i18n, { supportedLanguages } from "@/i18n";
import { changePassword } from "@/lib/auth";
import { toThemePreference } from "@/lib/ui-config";

/* ------------------------------------------------------------------ */
/*  Types & Constants                                                  */
/* ------------------------------------------------------------------ */

type SettingsSection = "security" | "account" | "appearance";

const SETTINGS_SECTIONS = [
	{ id: "security", labelKey: "settings.security", icon: LockKeyIcon },
	{ id: "account", labelKey: "settings.account", icon: UserAccountIcon },
	{ id: "appearance", labelKey: "settings.appearance", icon: PaintBoardIcon },
] as const;

const DEFAULT_SECTION: SettingsSection = "security";

/* ------------------------------------------------------------------ */
/*  useSettingsSection — URL-hash-based active section                 */
/* ------------------------------------------------------------------ */

function parseHash(): SettingsSection {
	const raw = window.location.hash.replace("#", "");
	const valid = SETTINGS_SECTIONS.some((s) => s.id === raw);
	return valid ? (raw as SettingsSection) : DEFAULT_SECTION;
}

function subscribeHash(callback: () => void) {
	window.addEventListener("hashchange", callback);
	return () => window.removeEventListener("hashchange", callback);
}

function useSettingsSection() {
	const section = useSyncExternalStore(
		subscribeHash,
		parseHash,
		() => DEFAULT_SECTION,
	);

	const setSection = useCallback((id: SettingsSection) => {
		window.location.hash = id;
	}, []);

	return [section, setSection] as const;
}

/* ------------------------------------------------------------------ */
/*  Page Root                                                          */
/* ------------------------------------------------------------------ */

export function SettingsPage() {
	const { t } = useTranslation();
	const { isAuthenticated, isLoading: authLoading } = useAuth();

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
		return <Navigate to="/login" replace />;
	}

	return (
		<ThemeProvider>
			<SettingsContent />
		</ThemeProvider>
	);
}

/* ------------------------------------------------------------------ */
/*  Settings Sidebar Nav                                               */
/* ------------------------------------------------------------------ */

function SettingsNav({
	activeSection,
	onSelect,
}: {
	activeSection: SettingsSection;
	onSelect: (id: SettingsSection) => void;
}) {
	const { t } = useTranslation();

	return (
		<Sidebar collapsible="none" className="border-r bg-sidebar">
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							{SETTINGS_SECTIONS.map((section) => (
								<SidebarMenuItem key={section.id}>
									<SidebarMenuButton
										isActive={activeSection === section.id}
										onClick={() => onSelect(section.id)}
									>
										<HugeiconsIcon icon={section.icon} />
										<span>{t(section.labelKey)}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							))}
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
		</Sidebar>
	);
}

/* ------------------------------------------------------------------ */
/*  Conditional Section Content                                        */
/* ------------------------------------------------------------------ */

function SettingsSectionContent({ section }: { section: SettingsSection }) {
	switch (section) {
		case "security":
			return <SecurityCard />;
		case "account":
			return <ChangePasswordCard />;
		case "appearance":
			return <AppearanceCard />;
	}
}

/* ------------------------------------------------------------------ */
/*  Main Layout                                                        */
/* ------------------------------------------------------------------ */

function SettingsContent() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const [activeSection, setActiveSection] = useSettingsSection();

	const pageHeader = useMemo(
		() => (
			<div className="flex items-center gap-2">
				<Button variant="ghost" size="sm" onClick={() => navigate("/")}>
					<HugeiconsIcon
						icon={ArrowLeft02Icon}
						className="mr-2 h-4 w-4"
						aria-hidden="true"
					/>
					{t("common.back")}
				</Button>
				<Separator orientation="vertical" className="mx-1 h-4" />
				<HugeiconsIcon
					icon={Settings02Icon}
					className="h-5 w-5"
					aria-hidden="true"
				/>
				<h1 className="text-xl font-semibold">{t("settings.title")}</h1>
			</div>
		),
		[t, navigate],
	);

	return (
		<main className="min-h-screen bg-muted/40">
			{/* Desktop: sidebar + conditional content */}
			<div className="hidden md:block">
				<SidebarProvider>
					<div className="flex min-h-screen">
						<SettingsNav
							activeSection={activeSection}
							onSelect={setActiveSection}
						/>
						<SidebarInset className="flex-1 p-6">
							<div className="mx-auto max-w-2xl space-y-4">
								{pageHeader}
								<SettingsSectionContent section={activeSection} />
							</div>
						</SidebarInset>
					</div>
				</SidebarProvider>
			</div>

			{/* Mobile: stacked cards, no sidebar */}
			<div className="block p-4 md:hidden">
				<div className="mx-auto max-w-2xl space-y-4">
					{pageHeader}
					<SecurityCard />
					<ChangePasswordCard />
					<AppearanceCard />
				</div>
			</div>
		</main>
	);
}

/* ------------------------------------------------------------------ */
/*  Security Card                                                      */
/* ------------------------------------------------------------------ */

function SecurityCard() {
	const { t } = useTranslation();

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.security")}</CardTitle>
				<CardDescription>{t("settings.securityDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="rounded-lg border bg-card p-4">
					<E2EESettings />
				</div>
			</CardContent>
		</Card>
	);
}

/* ------------------------------------------------------------------ */
/*  Change Password Card                                               */
/* ------------------------------------------------------------------ */

function ChangePasswordCard() {
	const { t } = useTranslation();
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

		if (formData.newPassword !== formData.confirmPassword) {
			setError(t("settings.passwordMismatch"));
			return;
		}

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

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.account")}</CardTitle>
				<CardDescription>{t("settings.accountDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="rounded-lg border bg-card p-4">
					<h3 className="mb-3 font-medium">{t("settings.changePassword")}</h3>
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
									setFormData((prev) => ({
										...prev,
										currentPassword: e.target.value,
									}))
								}
								required
								disabled={isSubmitting}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="newPassword">{t("settings.newPassword")}</Label>
							<Input
								id="newPassword"
								name="new-password"
								autoComplete="new-password"
								type="password"
								value={formData.newPassword}
								onChange={(e) =>
									setFormData((prev) => ({
										...prev,
										newPassword: e.target.value,
									}))
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
									setFormData((prev) => ({
										...prev,
										confirmPassword: e.target.value,
									}))
								}
								required
								disabled={isSubmitting}
								minLength={8}
							/>
						</div>

						{error && (
							<div
								role="alert"
								className="rounded-sm bg-destructive/10 p-3 text-destructive text-sm"
								aria-live="assertive"
							>
								{error}
							</div>
						)}

						{success && (
							<output
								className="block rounded-sm bg-green-500/10 p-3 text-green-600 dark:text-green-400 text-sm"
								aria-live="polite"
							>
								{success}
							</output>
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
	);
}

/* ------------------------------------------------------------------ */
/*  Appearance Card                                                    */
/* ------------------------------------------------------------------ */

function AppearanceCard() {
	const { t } = useTranslation();
	const { theme, setTheme } = useTheme();

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<HugeiconsIcon
						icon={PaintBoardIcon}
						className="h-5 w-5"
						aria-hidden="true"
					/>
					{t("settings.appearance")}
				</CardTitle>
				<CardDescription>{t("settings.appearanceDescription")}</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					{/* Theme Select */}
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="theme-select">{t("theme.label")}</Label>
							<p className="text-muted-foreground text-sm">
								{t("settings.themeHint")}
							</p>
						</div>
						<Select
							value={theme}
							onValueChange={(value) => setTheme(toThemePreference(value))}
						>
							<SelectTrigger id="theme-select" className="w-full sm:w-40">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="light">
									<div className="flex items-center gap-2">
										<HugeiconsIcon
											icon={SunIcon}
											strokeWidth={2}
											className="h-4 w-4"
											aria-hidden="true"
										/>
										{t("theme.light")}
									</div>
								</SelectItem>
								<SelectItem value="dark">
									<div className="flex items-center gap-2">
										<HugeiconsIcon
											icon={MoonIcon}
											strokeWidth={2}
											className="h-4 w-4"
											aria-hidden="true"
										/>
										{t("theme.dark")}
									</div>
								</SelectItem>
								<SelectItem value="system">
									<div className="flex items-center gap-2">
										<HugeiconsIcon
											icon={ComputerIcon}
											strokeWidth={2}
											className="h-4 w-4"
											aria-hidden="true"
										/>
										{t("theme.system")}
									</div>
								</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<Separator />

					{/* Language Select */}
					<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
						<div className="space-y-0.5">
							<Label htmlFor="language-select">
								{t("languageSwitcher.label")}
							</Label>
							<p className="text-muted-foreground text-sm">
								{t("settings.languageHint")}
							</p>
						</div>
						<Select
							value={i18n.resolvedLanguage ?? "en"}
							onValueChange={(value) => i18n.changeLanguage(value)}
						>
							<SelectTrigger id="language-select" className="w-full sm:w-40">
								<SelectValue placeholder={t("languageSwitcher.placeholder")} />
							</SelectTrigger>
							<SelectContent>
								{supportedLanguages.map((lang) => (
									<SelectItem key={lang} value={lang}>
										{t(`common.languages.${lang}`)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
