import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DemoHeader } from "@/components/DemoHeader";
import { GetStartedDialog } from "@/components/GetStartedDialog";
import { LegalLinks } from "@/components/legal/LegalLinks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { PRO_MONTHLY_PRICE_DISPLAY } from "@/lib/pricing";

const WEB_APP_URL =
	import.meta.env.VITE_WEB_APP_URL || "https://app.mobvibe.net";

const billingFactKeys = ["provider", "renewal", "taxes"] as const;

export function PricingPage() {
	const { t } = useTranslation();

	const freeFeatures = useMemo(
		() =>
			t("pricing.free.features", {
				returnObjects: true,
			}) as string[],
		[t],
	);
	const proFeatures = useMemo(
		() =>
			t("pricing.pro.features", {
				returnObjects: true,
			}) as string[],
		[t],
	);

	return (
		<div className="min-h-screen bg-background text-foreground">
			<DemoHeader currentPathname="/pricing" />
			<main className="relative overflow-hidden">
				<div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.18),transparent_36%),linear-gradient(to_bottom,transparent,rgba(245,158,11,0.06))]" />
				<div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:24px_24px] opacity-25 [mask-image:linear-gradient(to_bottom,white,transparent_85%)]" />

				<section className="relative border-b">
					<div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 md:px-6 md:py-14">
						<div className="max-w-3xl space-y-4">
							<Badge
								variant="outline"
								className="border-primary/40 bg-background/80 text-[10px] uppercase tracking-[0.24em]"
							>
								{t("pricing.badge")}
							</Badge>
							<div className="space-y-3">
								<h1 className="max-w-2xl text-3xl leading-tight font-medium tracking-tight md:text-5xl">
									{t("pricing.title")}
								</h1>
								<p className="max-w-2xl text-sm leading-7 text-muted-foreground md:text-base">
									{t("pricing.description", {
										price: PRO_MONTHLY_PRICE_DISPLAY,
									})}
								</p>
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-3">
							<GetStartedDialog>
								<Button size="lg">{t("pricing.free.cta")}</Button>
							</GetStartedDialog>
							<Button variant="outline" size="lg" asChild>
								<a href={WEB_APP_URL} target="_blank" rel="noopener noreferrer">
									{t("pricing.pro.cta")}
								</a>
							</Button>
						</div>

						<p className="max-w-3xl text-[11px] leading-6 text-muted-foreground">
							{t("pricing.footnote")}
						</p>
					</div>
				</section>

				<section className="relative">
					<div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 md:grid-cols-2 md:px-6 md:py-12">
						<Card className="border-border/80 bg-background/92">
							<CardHeader className="border-b">
								<CardDescription>{t("pricing.free.tagline")}</CardDescription>
								<CardTitle className="text-xl md:text-2xl">
									{t("pricing.free.name")}
								</CardTitle>
							</CardHeader>
							<CardContent className="space-y-5 pt-1">
								<div className="flex items-end gap-3">
									<span className="text-4xl leading-none font-medium">
										{t("pricing.free.price")}
									</span>
									<span className="pb-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
										{t("pricing.free.interval")}
									</span>
								</div>
								<p className="text-sm text-foreground">
									{t("pricing.free.summary")}
								</p>
								<div className="space-y-2">
									<p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
										{t("pricing.includedLabel")}
									</p>
									<ul className="space-y-2 text-sm leading-6">
										{freeFeatures.map((feature) => (
											<li key={feature} className="flex gap-2">
												<span className="text-primary">+</span>
												<span>{feature}</span>
											</li>
										))}
									</ul>
								</div>
							</CardContent>
							<CardFooter>
								<GetStartedDialog>
									<Button className="w-full">{t("pricing.free.cta")}</Button>
								</GetStartedDialog>
							</CardFooter>
						</Card>

						<Card className="border-primary/45 bg-background/96 ring-primary/20">
							<CardHeader className="border-b">
								<div className="flex items-start justify-between gap-3">
									<div className="space-y-1">
										<CardDescription>
											{t("pricing.pro.tagline")}
										</CardDescription>
										<CardTitle className="text-xl md:text-2xl">
											{t("pricing.pro.name")}
										</CardTitle>
									</div>
									<Badge
										variant="outline"
										className="border-primary/50 bg-primary/10 text-[10px] uppercase tracking-[0.22em]"
									>
										{t("pricing.pro.highlight")}
									</Badge>
								</div>
							</CardHeader>
							<CardContent className="space-y-5 pt-1">
								<div className="flex items-end gap-3">
									<span className="text-4xl leading-none font-medium">
										{t("pricing.pro.price", {
											price: PRO_MONTHLY_PRICE_DISPLAY,
										})}
									</span>
									<span className="pb-1 text-xs uppercase tracking-[0.2em] text-muted-foreground">
										{t("pricing.pro.interval")}
									</span>
								</div>
								<p className="text-sm text-foreground">
									{t("pricing.pro.summary")}
								</p>
								<div className="space-y-2">
									<p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
										{t("pricing.includedLabel")}
									</p>
									<ul className="space-y-2 text-sm leading-6">
										{proFeatures.map((feature) => (
											<li key={feature} className="flex gap-2">
												<span className="text-primary">+</span>
												<span>{feature}</span>
											</li>
										))}
									</ul>
								</div>
							</CardContent>
							<CardFooter>
								<Button className="w-full" asChild>
									<a
										href={WEB_APP_URL}
										target="_blank"
										rel="noopener noreferrer"
									>
										{t("pricing.pro.cta")}
									</a>
								</Button>
							</CardFooter>
						</Card>
					</div>
				</section>

				<section className="relative border-t border-dashed">
					<div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 md:grid-cols-3 md:px-6 md:py-12">
						{billingFactKeys.map((key) => (
							<Card key={key} size="sm" className="bg-background/88">
								<CardHeader>
									<CardDescription>
										{t(`pricing.facts.${key}.label`)}
									</CardDescription>
									<CardTitle className="text-base">
										{t(`pricing.facts.${key}.value`)}
									</CardTitle>
								</CardHeader>
							</Card>
						))}
					</div>
				</section>

				<section className="relative border-t">
					<div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-8 md:px-6 md:py-12">
						<div className="max-w-3xl space-y-2">
							<p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
								{t("pricing.legalEyebrow")}
							</p>
							<h2 className="text-xl leading-tight font-medium">
								{t("pricing.legalTitle")}
							</h2>
							<p className="text-sm leading-7 text-muted-foreground">
								{t("pricing.legalDescription")}
							</p>
						</div>

						<div className="flex flex-col gap-4 border border-dashed border-border/80 bg-background/88 p-4">
							<LegalLinks
								className="gap-x-5 gap-y-2"
								linkClassName="text-xs uppercase tracking-[0.18em]"
							/>
							<div className="flex flex-wrap gap-3">
								<Button variant="outline" size="sm" asChild>
									<a href="/terms">{t("pricing.policyCta")}</a>
								</Button>
								<Button variant="ghost" size="sm" asChild>
									<a href="/">{t("legal.backHome")}</a>
								</Button>
							</div>
						</div>
					</div>
				</section>
			</main>
		</div>
	);
}
