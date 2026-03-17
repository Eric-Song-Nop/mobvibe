import {
	DiscordIcon,
	GithubIcon,
	Menu01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/brand-logo";
import { GetStartedDialog } from "@/components/GetStartedDialog";
import { Button } from "@/components/ui/button";
import { supportedLanguages } from "@/i18n";
import { cn } from "@/lib/utils";

interface DemoHeaderProps {
	activeFeatureTitle?: string;
	currentPathname: "/" | "/pricing";
	onMenuToggle?: () => void;
}

export function DemoHeader({
	activeFeatureTitle,
	currentPathname,
	onMenuToggle,
}: DemoHeaderProps) {
	const { t, i18n } = useTranslation();
	const isPricingPage = currentPathname === "/pricing";
	const activeLanguage = i18n.resolvedLanguage?.startsWith("zh") ? "zh" : "en";

	return (
		<header className="bg-background/80 border-b px-4 py-3 backdrop-blur shrink-0">
			<div className="mx-auto flex w-full max-w-5xl items-center gap-2">
				{onMenuToggle ? (
					<Button
						variant="ghost"
						size="icon-sm"
						className="md:hidden"
						onClick={onMenuToggle}
					>
						<HugeiconsIcon
							icon={Menu01Icon}
							strokeWidth={2}
							className="size-4"
							aria-hidden="true"
						/>
						<span className="sr-only">{t("header.toggleMenu")}</span>
					</Button>
				) : null}

				<a href="/" className="flex items-center gap-2">
					<BrandLogo alt="" className="size-5" aria-hidden="true" />
					<span className="text-sm font-medium">{t("common.appName")}</span>
				</a>
				{activeFeatureTitle && (
					<>
						<span className="text-muted-foreground text-sm">/</span>
						<span className="text-muted-foreground truncate text-sm">
							{activeFeatureTitle}
						</span>
					</>
				)}

				<div className="flex-1" />

				{isPricingPage ? (
					<div className="hidden items-center gap-1 sm:flex">
						{supportedLanguages.map((language) => {
							const isActive = language === activeLanguage;
							return (
								<Button
									key={language}
									type="button"
									variant={isActive ? "outline" : "ghost"}
									size="xs"
									className={
										isActive ? "border-primary/40 bg-primary/10" : undefined
									}
									onClick={() => i18n.changeLanguage(language)}
								>
									{t(`common.languages.${language}`)}
								</Button>
							);
						})}
					</div>
				) : null}

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

				<a
					href="https://github.com/Eric-Song-Nop/mobvibe"
					target="_blank"
					rel="noopener noreferrer"
				>
					<Button variant="ghost" size="icon-sm">
						<HugeiconsIcon
							icon={GithubIcon}
							strokeWidth={2}
							className="size-4"
							aria-hidden="true"
						/>
						<span className="sr-only">{t("header.github")}</span>
					</Button>
				</a>

				<a
					href="https://discord.gg/wrv2JXz7"
					target="_blank"
					rel="noopener noreferrer"
				>
					<Button variant="ghost" size="icon-sm">
						<HugeiconsIcon
							icon={DiscordIcon}
							strokeWidth={2}
							className="size-4"
							aria-hidden="true"
						/>
						<span className="sr-only">{t("header.discord")}</span>
					</Button>
				</a>

				{isPricingPage ? (
					<div className="flex items-center gap-1 sm:hidden">
						{supportedLanguages.map((language) => {
							const isActive = language === activeLanguage;
							return (
								<Button
									key={language}
									type="button"
									variant={isActive ? "outline" : "ghost"}
									size="xs"
									className={
										isActive ? "border-primary/40 bg-primary/10" : undefined
									}
									onClick={() => i18n.changeLanguage(language)}
								>
									{t(`common.languages.${language}`)}
								</Button>
							);
						})}
					</div>
				) : null}

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
