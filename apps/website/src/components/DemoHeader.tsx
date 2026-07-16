import { DiscordIcon, GithubIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { BrandLogo } from "@mobvibe/ui/brand-logo";
import { Button } from "@mobvibe/ui/button";
import { SidebarTrigger } from "@mobvibe/ui/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@mobvibe/ui/toggle-group";
import { useTranslation } from "react-i18next";
import { GetStartedDialog } from "@/components/GetStartedDialog";
import { supportedLanguages } from "@/i18n";
import { cn } from "@/lib/utils";

interface DemoHeaderProps {
	activeFeatureTitle?: string;
	currentPathname: "/" | "/pricing";
	showSidebarTrigger?: boolean;
}

export function DemoHeader({
	activeFeatureTitle,
	currentPathname,
	showSidebarTrigger = false,
}: DemoHeaderProps) {
	const { t } = useTranslation();
	const isPricingPage = currentPathname === "/pricing";

	return (
		<header className="bg-background/80 border-b px-4 py-3 backdrop-blur shrink-0">
			<div className="mx-auto flex w-full max-w-5xl items-center gap-2">
				{showSidebarTrigger ? (
					<SidebarTrigger aria-label={t("header.toggleMenu")} />
				) : null}

				<a href="/" className="flex items-center gap-2">
					<BrandLogo alt="" className="size-5" aria-hidden="true" />
					<span className="text-sm font-medium">{t("common.appName")}</span>
				</a>
				{activeFeatureTitle ? (
					<>
						<span className="text-muted-foreground text-sm">/</span>
						<span className="text-muted-foreground truncate text-sm">
							{activeFeatureTitle}
						</span>
					</>
				) : null}

				<div className="flex-1" />

				{isPricingPage ? <LanguageToggle className="hidden sm:flex" /> : null}

				<Button
					variant={isPricingPage ? "outline" : "ghost"}
					size="sm"
					className={cn(
						"hidden sm:inline-flex",
						isPricingPage && "border-primary/40 bg-primary/10",
					)}
					asChild
				>
					<a href="/pricing" aria-current={isPricingPage ? "page" : undefined}>
						{t("header.pricing")}
					</a>
				</Button>

				<Button variant="ghost" size="icon-sm" asChild>
					<a
						href="https://github.com/Eric-Song-Nop/mobvibe"
						target="_blank"
						rel="noopener noreferrer"
					>
						<HugeiconsIcon
							icon={GithubIcon}
							strokeWidth={2}
							aria-hidden="true"
						/>
						<span className="sr-only">{t("header.github")}</span>
					</a>
				</Button>

				<Button variant="ghost" size="icon-sm" asChild>
					<a
						href="https://discord.gg/wrv2JXz7"
						target="_blank"
						rel="noopener noreferrer"
					>
						<HugeiconsIcon
							icon={DiscordIcon}
							strokeWidth={2}
							aria-hidden="true"
						/>
						<span className="sr-only">{t("header.discord")}</span>
					</a>
				</Button>

				{isPricingPage ? <LanguageToggle className="flex sm:hidden" /> : null}

				<Button
					variant={isPricingPage ? "outline" : "ghost"}
					size="sm"
					className={cn(
						"sm:hidden",
						isPricingPage && "border-primary/40 bg-primary/10",
					)}
					asChild
				>
					<a href="/pricing" aria-current={isPricingPage ? "page" : undefined}>
						{t("header.pricing")}
					</a>
				</Button>

				<GetStartedDialog>
					<Button size="sm">{t("header.getStarted")}</Button>
				</GetStartedDialog>
			</div>
		</header>
	);
}

function LanguageToggle({ className }: { className?: string }) {
	const { t, i18n } = useTranslation();
	const activeLanguage = i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en";

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			value={activeLanguage}
			onValueChange={(language) => {
				if (language) void i18n.changeLanguage(language);
			}}
			className={className}
			aria-label={t("common.languageSelector")}
		>
			{supportedLanguages.map((language) => (
				<ToggleGroupItem key={language} value={language}>
					{t(`common.languages.${language}`)}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
