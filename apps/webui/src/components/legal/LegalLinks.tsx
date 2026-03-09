import { legalDocuments } from "@mobvibe/shared";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { cn } from "@/lib/utils";

type LegalLinksProps = {
	className?: string;
	linkClassName?: string;
};

export function LegalLinks({ className, linkClassName }: LegalLinksProps) {
	const { t } = useTranslation();

	return (
		<nav
			aria-label={t("legal.navigation")}
			className={cn("flex flex-wrap items-center gap-2", className)}
		>
			{legalDocuments.map((document) => (
				<Link
					key={document.id}
					to={document.slug}
					className={cn(
						"text-muted-foreground text-xs underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
						linkClassName,
					)}
				>
					{t(`legal.links.${document.id}`)}
				</Link>
			))}
		</nav>
	);
}
