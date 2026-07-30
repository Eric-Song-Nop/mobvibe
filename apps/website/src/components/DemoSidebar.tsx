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
import { Badge } from "@mobvibe/ui/badge";
import { BrandLogo } from "@mobvibe/ui/brand-logo";
import { Button } from "@mobvibe/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@mobvibe/ui/dropdown-menu";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarGroupLabel,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSeparator,
	useSidebar,
} from "@mobvibe/ui/sidebar";
import { useTheme } from "@mobvibe/ui/theme-provider";
import { useTranslation } from "react-i18next";
import { LegalLinks } from "@/components/legal/LegalLinks";
import type { FeatureGroup } from "@/data/features";
import { supportedLanguages } from "@/i18n";

interface DemoSidebarProps {
	groups: FeatureGroup[];
	activeFeatureId: string;
	onFeatureSelect: (id: string) => void;
}

export function DemoSidebar({
	groups,
	activeFeatureId,
	onFeatureSelect,
}: DemoSidebarProps) {
	const { theme, setTheme } = useTheme();
	const { setOpenMobile } = useSidebar();
	const { t, i18n } = useTranslation();

	return (
		<Sidebar
			mobileTitle={t("sidebar.navigationTitle")}
			mobileDescription={t("sidebar.navigationDescription")}
		>
			<SidebarHeader className="p-0">
				<div className="flex h-12 items-center gap-2 px-4">
					<BrandLogo alt="" className="size-6" aria-hidden="true" />
					<span className="text-sm font-medium">{t("common.appName")}</span>
				</div>
				<SidebarSeparator className="mx-0" />
			</SidebarHeader>

			<SidebarContent>
				<nav aria-label={t("sidebar.navigationTitle")}>
					{groups.map((group, groupIndex) => (
						<div key={group.key}>
							{groupIndex > 0 ? <SidebarSeparator /> : null}
							<SidebarGroup>
								<SidebarGroupLabel className="h-auto py-1 text-[10px] uppercase tracking-wider">
									{group.label}
								</SidebarGroupLabel>
								<SidebarGroupContent>
									<SidebarMenu className="gap-0.5">
										{group.features.map((feature) => {
											const isActive = feature.id === activeFeatureId;
											return (
												<SidebarMenuItem key={feature.id}>
													<SidebarMenuButton
														type="button"
														isActive={isActive}
														aria-current={isActive ? "page" : undefined}
														onClick={() => {
															onFeatureSelect(feature.id);
															setOpenMobile(false);
														}}
													>
														<span>{feature.title}</span>
													</SidebarMenuButton>
												</SidebarMenuItem>
											);
										})}
									</SidebarMenu>
								</SidebarGroupContent>
							</SidebarGroup>
						</div>
					))}
				</nav>
			</SidebarContent>

			<SidebarFooter className="gap-0 p-0">
				<SidebarSeparator className="mx-0" />
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
									aria-hidden="true"
								/>
								<span className="text-xs">
									{t(`common.languages.${i18n.resolvedLanguage ?? "en"}`)}
								</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="start" side="top">
							{supportedLanguages.map((language) => (
								<DropdownMenuItem
									key={language}
									onClick={() => i18n.changeLanguage(language)}
								>
									{t(`common.languages.${language}`)}
								</DropdownMenuItem>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<SidebarSeparator className="mx-0" />
				<div className="flex flex-col gap-1.5 p-2">
					<Badge
						variant="outline"
						className="border-emerald-500/40 text-[10px] text-emerald-600 dark:text-emerald-400"
					>
						<span className="mr-0.5 inline-block size-1.5 rounded-full bg-emerald-500" />
						{t("profile.openToWork")}
					</Badge>
					<p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
						{t("profile.description")}
					</p>
					<div className="flex gap-0.5">
						<Button variant="ghost" size="icon-xs" asChild>
							<a href="mailto:Ericoolen@yeah.net">
								<HugeiconsIcon
									icon={Mail01Icon}
									strokeWidth={2}
									aria-hidden="true"
								/>
								<span className="sr-only">{t("profile.email")}</span>
							</a>
						</Button>
						<Button variant="ghost" size="icon-xs" asChild>
							<a
								href="https://github.com/Eric-Song-Nop"
								target="_blank"
								rel="noopener noreferrer"
							>
								<HugeiconsIcon
									icon={GithubIcon}
									strokeWidth={2}
									aria-hidden="true"
								/>
								<span className="sr-only">{t("profile.github")}</span>
							</a>
						</Button>
					</div>
					<div className="pt-1">
						<LegalLinks className="gap-x-3 gap-y-1" />
					</div>
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
