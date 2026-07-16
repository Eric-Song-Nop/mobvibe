import { Button } from "@mobvibe/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@mobvibe/ui/dialog";
import { Separator } from "@mobvibe/ui/separator";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

interface GetStartedDialogProps {
	children: React.ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

const CLI_COMMAND = "npx @mobvibe/cli login";
const WEB_APP_URL =
	import.meta.env.VITE_WEB_APP_URL || "https://app.mobvibe.net";

export function GetStartedDialog({
	children,
	open,
	onOpenChange,
}: GetStartedDialogProps) {
	const { t } = useTranslation();
	const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
		"idle",
	);

	const handleCopy = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(CLI_COMMAND);
			setCopyStatus("copied");
		} catch {
			setCopyStatus("error");
		}
	}, []);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{t("getStarted.title")}</DialogTitle>
					<DialogDescription>{t("getStarted.description")}</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col gap-4">
					{/* Step 1 */}
					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">
							{t("getStarted.step1Title")}
						</span>
						<div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2">
							<code className="flex-1 text-xs">{CLI_COMMAND}</code>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => void handleCopy()}
							>
								<span className="sr-only">{t("getStarted.copyCommand")}</span>
								<svg
									className="size-3.5"
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									aria-hidden="true"
								>
									<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
									<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
								</svg>
							</Button>
						</div>
						<p className="text-muted-foreground text-xs">
							{t("getStarted.step1Description")}
						</p>
						{copyStatus !== "idle" ? (
							<p
								role={copyStatus === "error" ? "alert" : "status"}
								className="text-muted-foreground text-xs"
							>
								{t(
									copyStatus === "error"
										? "getStarted.copyError"
										: "getStarted.copySuccess",
								)}
							</p>
						) : null}
					</div>

					<Separator />

					{/* Step 2 */}
					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">
							{t("getStarted.step2Title")}
						</span>
						<div className="flex flex-wrap gap-2">
							<Button variant="outline" size="sm" asChild>
								<a href={WEB_APP_URL} target="_blank" rel="noopener noreferrer">
									{t("getStarted.webApp")}
								</a>
							</Button>
							<Button variant="outline" size="sm" asChild>
								<a
									href="https://github.com/Eric-Song-Nop/mobvibe/releases/latest"
									target="_blank"
									rel="noopener noreferrer"
								>
									{t("getStarted.androidApk")}
								</a>
							</Button>
						</div>
					</div>
				</div>

				<DialogFooter>
					<DialogClose asChild>
						<Button variant="outline">{t("getStarted.close")}</Button>
					</DialogClose>
					<Button variant="outline" asChild>
						<a
							href="https://github.com/Eric-Song-Nop/mobvibe"
							target="_blank"
							rel="noopener noreferrer"
						>
							{t("getStarted.viewOnGitHub")}
						</a>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
