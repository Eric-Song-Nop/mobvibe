import { Alert01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

type E2EEMissingBannerProps = {
	visible: boolean;
};

export function E2EEMissingBanner({ visible }: E2EEMissingBannerProps) {
	const { t } = useTranslation();

	if (!visible) return null;

	return (
		<div className="border-warning/40 bg-warning/5 flex flex-col gap-2 rounded-none border p-4">
			<div className="flex items-center gap-2">
				<HugeiconsIcon
					icon={Alert01Icon}
					className="text-warning h-5 w-5 shrink-0"
					strokeWidth={2}
				/>
				<span className="text-warning text-sm font-semibold">
					{t("e2ee.missingKeyTitle")}
				</span>
			</div>
			<p className="text-muted-foreground text-sm">
				{t("e2ee.missingKeyDescription")}
			</p>
			<p className="text-muted-foreground text-sm">
				{t("e2ee.missingKeyCliHint").split("`mobvibe e2ee show`")[0]}
				<code className="bg-muted rounded px-1 py-0.5 font-mono text-xs">
					mobvibe e2ee show
				</code>
				{t("e2ee.missingKeyCliHint").split("`mobvibe e2ee show`")[1]}
			</p>
			<div className="mt-1">
				<Button variant="outline" size="sm" asChild>
					<Link to="/settings#security">
						{t("e2ee.missingKeySettingsLink")}
					</Link>
				</Button>
			</div>
		</div>
	);
}
