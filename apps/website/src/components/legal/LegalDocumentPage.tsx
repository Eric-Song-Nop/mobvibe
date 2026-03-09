import { ArrowLeft02Icon, Legal01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
	getLegalDocument,
	type LegalDocumentId,
	legalDocuments,
} from "@/lib/legal-data";
import { cn } from "@/lib/utils";

type LegalDocumentPageProps = {
	documentId: LegalDocumentId;
};

export function LegalDocumentPage({ documentId }: LegalDocumentPageProps) {
	const { t } = useTranslation();
	const document = getLegalDocument(documentId);

	return (
		<div className="min-h-dvh bg-background text-foreground">
			<div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_color-mix(in_oklch,var(--primary)_18%,transparent),transparent_48%),linear-gradient(180deg,color-mix(in_oklch,var(--muted)_84%,transparent),transparent_38%)]" />
			<div className="relative mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
				<a
					href="#legal-content"
					className="sr-only absolute left-4 top-4 z-10 bg-background px-3 py-2 text-xs focus:not-sr-only focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
				>
					{t("legal.skipToContent")}
				</a>
				<header className="mb-8 flex flex-col gap-4 border border-border/70 bg-background/92 p-4 backdrop-blur sm:flex-row sm:items-start sm:justify-between">
					<div className="space-y-3">
						<Button variant="ghost" size="sm" asChild>
							<a href="/">
								<HugeiconsIcon
									icon={ArrowLeft02Icon}
									className="mr-2 size-4"
									aria-hidden="true"
								/>
								{t("legal.backHome")}
							</a>
						</Button>
						<div className="space-y-2">
							<div className="inline-flex items-center gap-2 border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] uppercase tracking-[0.24em] text-primary">
								<HugeiconsIcon
									icon={Legal01Icon}
									className="size-3"
									aria-hidden="true"
								/>
								{t("legal.pageBadge")}
							</div>
							<div>
								<h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
									{document.locales.en.title}
								</h1>
								<p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground sm:text-base">
									{document.locales.en.summary}
								</p>
								<p className="mt-3 text-xs uppercase tracking-[0.24em] text-muted-foreground">
									{t("legal.bilingual")}
								</p>
							</div>
						</div>
					</div>

					<div className="grid min-w-0 gap-3 border border-border/70 bg-muted/35 p-3 text-xs sm:w-[22rem]">
						<MetaRow label={t("legal.effectiveDate")}>
							<span>{document.effectiveDate.en}</span>
							<span className="text-muted-foreground">
								{document.effectiveDate.zh}
							</span>
						</MetaRow>
						<MetaRow label={t("legal.operator")}>
							<span>{document.operatorName}</span>
						</MetaRow>
						<MetaRow label={t("legal.contact")}>
							<a
								href={`mailto:${document.contactEmail}`}
								className="text-foreground underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
							>
								{document.contactEmail}
							</a>
						</MetaRow>
					</div>
				</header>

				<div className="mb-8 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
					<section className="border border-border/70 bg-background/94 p-4 backdrop-blur">
						<p className="mb-3 text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
							{t("legal.otherPolicies")}
						</p>
						<div className="flex flex-wrap gap-2">
							{legalDocuments.map((item) => (
								<Button
									key={item.id}
									variant={item.id === document.id ? "default" : "outline"}
									size="sm"
									asChild
								>
									<a href={item.slug}>{t(`legal.links.${item.id}`)}</a>
								</Button>
							))}
						</div>
					</section>

					<section className="grid gap-4 border border-border/70 bg-background/94 p-4 backdrop-blur sm:grid-cols-2 lg:grid-cols-1">
						<TableOfContents
							title={t("legal.english")}
							sections={document.locales.en.sections}
							prefix="en"
						/>
						<TableOfContents
							title={t("legal.chinese")}
							sections={document.locales.zh.sections}
							prefix="zh"
						/>
					</section>
				</div>

				<main id="legal-content" className="grid gap-6">
					<LocaleArticle
						localeLabel={t("legal.english")}
						title={document.locales.en.title}
						summary={document.locales.en.summary}
						sections={document.locales.en.sections}
						prefix="en"
					/>
					<LocaleArticle
						localeLabel={t("legal.chinese")}
						title={document.locales.zh.title}
						summary={document.locales.zh.summary}
						sections={document.locales.zh.sections}
						prefix="zh"
					/>
				</main>
			</div>
		</div>
	);
}

function MetaRow({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="grid gap-1">
			<span className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
				{label}
			</span>
			<div className="grid gap-1">{children}</div>
		</div>
	);
}

function TableOfContents({
	title,
	sections,
	prefix,
}: {
	title: string;
	sections: Array<{ id: string; title: string }>;
	prefix: string;
}) {
	const { t } = useTranslation();

	return (
		<div className="space-y-3">
			<div>
				<p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
					{t("legal.outline")}
				</p>
				<h2 className="mt-1 text-sm font-semibold">{title}</h2>
			</div>
			<nav className="grid gap-2">
				{sections.map((section) => (
					<a
						key={`${prefix}-${section.id}`}
						href={`#${prefix}-${section.id}`}
						className="border border-border/70 bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					>
						{section.title}
					</a>
				))}
			</nav>
		</div>
	);
}

function LocaleArticle({
	localeLabel,
	title,
	summary,
	sections,
	prefix,
}: {
	localeLabel: string;
	title: string;
	summary: string;
	sections: Array<{
		id: string;
		title: string;
		paragraphs: string[];
		bullets?: string[];
	}>;
	prefix: string;
}) {
	return (
		<article className="border border-border/70 bg-background/96 p-5 backdrop-blur sm:p-6">
			<div className="mb-6 space-y-3">
				<p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
					{localeLabel}
				</p>
				<div>
					<h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
					<p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
						{summary}
					</p>
				</div>
			</div>

			<div className="grid gap-4">
				{sections.map((section, index) => (
					<section
						key={`${prefix}-${section.id}`}
						id={`${prefix}-${section.id}`}
						className="scroll-mt-6 border border-border/70 bg-muted/20 p-4"
					>
						<div className="space-y-3">
							<h3 className="text-base font-semibold">{section.title}</h3>
							{section.paragraphs.map((paragraph) => (
								<p
									key={paragraph}
									className="text-sm leading-7 text-foreground/88"
								>
									{paragraph}
								</p>
							))}
							{section.bullets ? (
								<ul className="grid gap-2 text-sm leading-7 text-foreground/88">
									{section.bullets.map((bullet) => (
										<li
											key={bullet}
											className={cn(
												"grid grid-cols-[auto_1fr] gap-3",
												"before:mt-[0.78rem] before:size-1 before:rounded-full before:bg-primary before:content-['']",
											)}
										>
											<span>{bullet}</span>
										</li>
									))}
								</ul>
							) : null}
						</div>
						{index < sections.length - 1 ? (
							<Separator className="mt-4 opacity-50" />
						) : null}
					</section>
				))}
			</div>
		</article>
	);
}
