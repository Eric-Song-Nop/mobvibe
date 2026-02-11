import { useCallback, useRef } from "react";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

interface GetStartedDialogProps {
	children: React.ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

const CLI_COMMAND = "npx @mobvibe/cli login";

export function GetStartedDialog({
	children,
	open,
	onOpenChange,
}: GetStartedDialogProps) {
	const codeRef = useRef<HTMLElement>(null);

	const handleCopy = useCallback(() => {
		navigator.clipboard.writeText(CLI_COMMAND);
	}, []);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
			<AlertDialogContent className="sm:max-w-md">
				<AlertDialogHeader>
					<AlertDialogTitle>Get Started with Mobvibe</AlertDialogTitle>
					<AlertDialogDescription>
						Two steps to start managing your AI coding agents remotely.
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="flex flex-col gap-4">
					{/* Step 1 */}
					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">1. Install &amp; Login</span>
						<div className="bg-muted flex items-center gap-2 rounded-md px-3 py-2">
							<code ref={codeRef} className="flex-1 text-xs">
								{CLI_COMMAND}
							</code>
							<Button variant="ghost" size="icon-sm" onClick={handleCopy}>
								<span className="sr-only">Copy command</span>
								<svg
									className="size-3.5"
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeLinecap="round"
									strokeLinejoin="round"
									role="img"
									aria-label="Copy"
								>
									<rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
									<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
								</svg>
							</Button>
						</div>
						<p className="text-muted-foreground text-xs">
							This installs the CLI and connects your machine to the gateway.
						</p>
					</div>

					<Separator />

					{/* Step 2 */}
					<div className="flex flex-col gap-2">
						<span className="text-sm font-medium">2. Open Mobvibe</span>
						<div className="flex flex-wrap gap-2">
							<a
								href="https://mobvibe.netlify.app"
								target="_blank"
								rel="noopener noreferrer"
							>
								<Button variant="outline" size="sm">
									Web App
								</Button>
							</a>
							<a
								href="https://github.com/Eric-Song-Nop/mobvibe/releases/latest"
								target="_blank"
								rel="noopener noreferrer"
							>
								<Button variant="outline" size="sm">
									Android APK
								</Button>
							</a>
						</div>
					</div>
				</div>

				<AlertDialogFooter>
					<AlertDialogCancel>Close</AlertDialogCancel>
					<Button variant="outline" asChild>
						<a
							href="https://github.com/Eric-Song-Nop/mobvibe"
							target="_blank"
							rel="noopener noreferrer"
						>
							View on GitHub
						</a>
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
