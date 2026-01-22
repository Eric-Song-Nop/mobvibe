import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useNotificationStore } from "@/lib/notification-store";

type RegisterMachineDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

export function RegisterMachineDialog({
	open,
	onOpenChange,
}: RegisterMachineDialogProps) {
	const { t } = useTranslation();
	const pushNotification = useNotificationStore(
		(state) => state.pushNotification,
	);
	const [copied, setCopied] = useState(false);

	const webuiUrl =
		typeof window !== "undefined"
			? `${window.location.protocol}//${window.location.host}`
			: "http://localhost:5173";

	const command = `mobvibe login --webui ${webuiUrl}`;

	const handleCopy = async () => {
		try {
			await navigator.clipboard.writeText(command);
			setCopied(true);
			pushNotification({
				title: t("machines.commandCopied"),
				variant: "success",
			});
			setTimeout(() => setCopied(false), 2000);
		} catch {
			// Fallback for older browsers
			const textArea = document.createElement("textarea");
			textArea.value = command;
			document.body.appendChild(textArea);
			textArea.select();
			document.execCommand("copy");
			document.body.removeChild(textArea);
			setCopied(true);
			pushNotification({
				title: t("machines.commandCopied"),
				variant: "success",
			});
			setTimeout(() => setCopied(false), 2000);
		}
	};

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("machines.register")}</AlertDialogTitle>
					<AlertDialogDescription>
						{t("machines.registerDescription")}
					</AlertDialogDescription>
				</AlertDialogHeader>

				<div className="my-4">
					<div className="rounded-sm bg-muted p-3 font-mono text-xs break-all">
						{command}
					</div>
				</div>

				<AlertDialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						{t("common.close")}
					</Button>
					<Button onClick={handleCopy}>
						{copied ? "Copied!" : t("machines.copyCommand")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
