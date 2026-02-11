import { useState } from "react";
import { useTranslation } from "react-i18next";
import { GetStartedDialog } from "@/components/GetStartedDialog";
import { Button } from "@/components/ui/button";

export function DemoFooter() {
	const { t } = useTranslation();
	const [value, setValue] = useState("");
	const [dialogOpen, setDialogOpen] = useState(false);

	return (
		<footer className="bg-background/90 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shrink-0">
			<div className="mx-auto w-full max-w-5xl">
				<div className="relative flex flex-col border border-input focus-within:border-foreground/30">
					<textarea
						className="min-h-10 resize-none whitespace-pre-wrap break-words bg-transparent px-2.5 py-2 text-xs outline-none placeholder:text-muted-foreground md:min-h-16"
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
					<div className="flex items-center gap-1 px-2 pb-2">
						<div className="flex-1" />
						<GetStartedDialog open={dialogOpen} onOpenChange={setDialogOpen}>
							<Button size="icon-sm">
								<span className="text-xs">{t("footer.go")}</span>
							</Button>
						</GetStartedDialog>
					</div>
				</div>
			</div>
		</footer>
	);
}
