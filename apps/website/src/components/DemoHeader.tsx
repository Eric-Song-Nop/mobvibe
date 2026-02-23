import { GithubIcon, Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { GetStartedDialog } from "@/components/GetStartedDialog";
import { Button } from "@/components/ui/button";

interface DemoHeaderProps {
	activeFeatureTitle: string;
	onMenuToggle: () => void;
}

export function DemoHeader({
	activeFeatureTitle,
	onMenuToggle,
}: DemoHeaderProps) {
	const { t } = useTranslation();

	return (
		<header className="bg-background/80 border-b px-4 py-3 backdrop-blur shrink-0">
			<div className="mx-auto flex w-full max-w-5xl items-center gap-2">
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

				<img src="/logo.svg" alt="" className="size-5" aria-hidden="true" />
				<span className="text-sm font-medium">{t("common.appName")}</span>
				{activeFeatureTitle && (
					<>
						<span className="text-muted-foreground text-sm">/</span>
						<span className="text-muted-foreground truncate text-sm">
							{activeFeatureTitle}
						</span>
					</>
				)}

				<div className="flex-1" />

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

				<GetStartedDialog>
					<Button size="sm">{t("header.getStarted")}</Button>
				</GetStartedDialog>
			</div>
		</header>
	);
}
