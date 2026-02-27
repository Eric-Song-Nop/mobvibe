import {
	ComputerIcon,
	GithubIcon,
	LanguageSkillIcon,
	Mail01Icon,
	Moon02Icon,
	PaintBoardIcon,
	Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/theme-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import type { FeatureGroup } from "@/data/features";
import { supportedLanguages } from "@/i18n";
import { cn } from "@/lib/utils";

interface DemoSidebarProps {
	groups: FeatureGroup[];
	activeFeatureId: string;
	onFeatureSelect: (id: string) => void;
	open: boolean;
	onClose: () => void;
}

export function DemoSidebar({
	groups,
	activeFeatureId,
	onFeatureSelect,
	open,
	onClose,
}: DemoSidebarProps) {
	const { theme, setTheme } = useTheme();
	const { t, i18n } = useTranslation();

	return (
		<>
			{/* Mobile overlay */}
			{open && (
				<button
					type="button"
					className="fixed inset-0 z-40 bg-black/20 md:hidden"
					onClick={onClose}
					aria-label={t("sidebar.closeSidebar")}
				/>
			)}

			<aside
				className={cn(
					"bg-sidebar text-sidebar-foreground border-r border-sidebar-border flex flex-col",
					"fixed inset-y-0 left-0 z-50 w-64 transition-transform duration-200 md:relative md:translate-x-0",
					open ? "translate-x-0" : "-translate-x-full",
				)}
			>
				{/* Brand */}
				<div className="flex h-12 items-center gap-2 px-4">
					<img src="/logo.svg" alt="" className="size-6" aria-hidden="true" />
					<span className="text-sm font-medium">{t("common.appName")}</span>
				</div>

				<Separator />

				{/* Feature list — grouped */}
				<nav className="flex-1 overflow-y-auto p-2">
					<div className="flex flex-col gap-0.5">
						{groups.map((group, groupIndex) => (
							<div key={group.key}>
								{groupIndex > 0 && <Separator className="my-2" />}
								<span className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
									{group.label}
								</span>
								{group.features.map((feature) => {
									const isActive = feature.id === activeFeatureId;
									return (
										<button
											key={feature.id}
											type="button"
											onClick={() => {
												onFeatureSelect(feature.id);
												onClose();
											}}
											className={cn(
												"flex items-center gap-2 rounded-none border p-2 text-left text-xs transition-colors",
												isActive
													? "border-primary/40 bg-muted"
													: "border-transparent hover:bg-muted/50",
											)}
										>
											<span className="truncate">{feature.title}</span>
										</button>
									);
								})}
							</div>
						))}
					</div>
				</nav>

				<Separator />

				{/* Theme toggle & Language switcher */}
				<div className="flex flex-col gap-1 p-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="w-full justify-start gap-2"
							>
								<HugeiconsIcon
									icon={PaintBoardIcon}
									strokeWidth={2}
									className="size-3.5"
									aria-hidden="true"
								/>
								<span className="text-xs">
									{theme === "light"
										? t("theme.light")
										: theme === "dark"
											? t("theme.dark")
											: t("theme.system")}
								</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" side="top">
							<DropdownMenuItem onClick={() => setTheme("light")}>
								<HugeiconsIcon
									icon={Sun03Icon}
									strokeWidth={2}
									aria-hidden="true"
								/>
								{t("theme.light")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setTheme("dark")}>
								<HugeiconsIcon
									icon={Moon02Icon}
									strokeWidth={2}
									aria-hidden="true"
								/>
								{t("theme.dark")}
							</DropdownMenuItem>
							<DropdownMenuItem onClick={() => setTheme("system")}>
								<HugeiconsIcon
									icon={ComputerIcon}
									strokeWidth={2}
									aria-hidden="true"
								/>
								{t("theme.system")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="sm"
								className="w-full justify-start gap-2"
							>
								<HugeiconsIcon
									icon={LanguageSkillIcon}
									strokeWidth={2}
									className="size-3.5"
									aria-hidden="true"
								/>
								<span className="text-xs">
									{t(`common.languages.${i18n.resolvedLanguage ?? "en"}`)}
								</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" side="top">
							{supportedLanguages.map((lang) => (
								<DropdownMenuItem
									key={lang}
									onClick={() => i18n.changeLanguage(lang)}
								>
									{t(`common.languages.${lang}`)}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<Separator />

				{/* Profile card */}
				<div className="flex flex-col gap-1.5 p-2">
					<Badge
						variant="outline"
						className="border-emerald-500/40 text-emerald-600 dark:text-emerald-400 text-[10px]"
					>
						<span className="mr-0.5 inline-block size-1.5 rounded-full bg-emerald-500" />
						{t("profile.openToWork")}
					</Badge>
					<p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
						{t("profile.description")}
					</p>
					<div className="flex gap-0.5">
						<a
							href="mailto:Ericoolen@yeah.net"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Button variant="ghost" size="icon-xs">
								<HugeiconsIcon
									icon={Mail01Icon}
									strokeWidth={2}
									className="size-3"
									aria-hidden="true"
								/>
								<span className="sr-only">{t("profile.email")}</span>
							</Button>
						</a>
						<a
							href="https://github.com/Eric-Song-Nop"
							target="_blank"
							rel="noopener noreferrer"
						>
							<Button variant="ghost" size="icon-xs">
								<HugeiconsIcon
									icon={GithubIcon}
									strokeWidth={2}
									className="size-3"
									aria-hidden="true"
								/>
								<span className="sr-only">{t("profile.github")}</span>
							</Button>
						</a>
					</div>
				</div>
			</aside>
		</>
	);
}
