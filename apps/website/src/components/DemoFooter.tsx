import {
	InputGroup,
	InputGroupAddon,
	InputGroupButton,
	InputGroupTextarea,
} from "@mobvibe/ui/input-group";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GetStartedDialog } from "@/components/GetStartedDialog";

export function DemoFooter() {
	const { t } = useTranslation();
	const [value, setValue] = useState("");
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<footer className="bg-background/90 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shrink-0">
			<div className="mx-auto w-full max-w-5xl">
				<InputGroup className="min-h-10 md:min-h-16">
					<InputGroupTextarea
						aria-label={t("footer.composerLabel")}
						name="demo-message"
						autoComplete="off"
						className="min-h-10 whitespace-pre-wrap break-words text-xs md:min-h-16"
						placeholder={t("footer.placeholder")}
						value={value}
						onChange={(e) => setValue(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								setDialogOpen(true);
							}
						}}
						rows={1}
					/>
					<InputGroupAddon align="block-end" className="justify-end">
						<GetStartedDialog open={dialogOpen} onOpenChange={setDialogOpen}>
							<InputGroupButton
								size="icon-sm"
								variant="default"
								aria-label={t("footer.go")}
							>
								<span className="text-xs">{t("footer.go")}</span>
							</InputGroupButton>
						</GetStartedDialog>
					</InputGroupAddon>
				</InputGroup>
			</div>
		</footer>
	);
}
