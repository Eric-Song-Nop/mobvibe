import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import PlanIndicator from "../plan-indicator";

vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));

vi.mock("@mobvibe/ui/popover", () => ({
	Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
		<>{children}</>
	),
	PopoverContent: ({ children }: { children: React.ReactNode }) => (
		<div data-testid="plan-popover">{children}</div>
	),
}));

vi.mock("@mobvibe/ui/sheet", () => ({
	Sheet: ({ children }: { children: React.ReactNode }) => <>{children}</>,
	SheetContent: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SheetHeader: ({ children }: { children: React.ReactNode }) => (
		<div>{children}</div>
	),
	SheetTitle: ({ children }: { children: React.ReactNode }) => (
		<h2>{children}</h2>
	),
}));

describe("PlanIndicator", () => {
	beforeEach(async () => {
		await i18n.changeLanguage("en");
	});

	it("preserves the legacy-only progress indicator", () => {
		const { container } = render(
			<PlanIndicator
				plan={[
					{
						content: "Legacy task",
						priority: "medium",
						status: "completed",
					},
				]}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Open 1 plan" }),
		).toHaveTextContent("1/1");
		expect(screen.getByRole("button", { name: "Open 1 plan" })).toHaveClass(
			"min-h-11",
			"min-w-11",
			"hover:bg-muted/60",
		);
		for (const progressbar of screen.getAllByRole("progressbar")) {
			expect(progressbar).toHaveAttribute("aria-valuemin", "0");
			expect(progressbar).toHaveAttribute("aria-valuemax", "1");
			expect(progressbar).toHaveAttribute("aria-valuenow", "1");
			expect(progressbar).toHaveAttribute(
				"aria-valuetext",
				"1 completed, 0 in progress, 0 pending",
			);
		}
		expect(
			container.querySelectorAll('[class*="motion-reduce:transition-none"]'),
		).toHaveLength(4);
		expect(screen.getByText("1 of 1 completed")).toBeVisible();
	});

	it("exposes item status without color and hides decorative icons", () => {
		const { container } = render(
			<PlanIndicator
				plans={[
					{
						type: "items",
						planId: "accessible",
						entries: [
							{
								content: "Active task",
								priority: "high",
								status: "in_progress",
							},
							{
								content: "Finished task",
								priority: "low",
								status: "completed",
							},
						],
					},
				]}
			/>,
		);

		expect(
			screen.getByText("1 in progress:", { selector: ".sr-only" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "1 completed" })).toBeVisible();
		expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(
			2,
		);
		expect(
			container.querySelector('[class*="motion-safe:animate-pulse"]'),
		).toBeInTheDocument();
	});

	it("contains long unbroken item and markdown content", async () => {
		const longToken = "x".repeat(300);
		const { container } = render(
			<PlanIndicator
				plan={[
					{
						content: longToken,
						priority: "medium",
						status: "pending",
					},
				]}
				plans={[
					{
						type: "markdown",
						planId: "long-markdown",
						content: `# ${longToken}`,
					},
				]}
			/>,
		);

		const itemText = screen.getByText(longToken, { selector: "span" });
		expect(itemText).toHaveClass("break-words", "[overflow-wrap:anywhere]");
		await screen.findByRole("heading", { name: longToken });
		expect(
			container.querySelector('[class*="overflow-wrap:anywhere"]'),
		).toBeInTheDocument();
		expect(
			container.querySelector('[class*="overflow-x-hidden"]'),
		).toBeInTheDocument();
	});

	it("uses the singular accessible label and keeps file URIs inert", () => {
		const { container } = render(
			<PlanIndicator
				plans={[
					{
						type: "file",
						planId: "implementation",
						uri: "file:///workspace/PLAN.md",
					},
				]}
			/>,
		);

		expect(screen.getByRole("button", { name: "Open 1 plan" })).toBeVisible();
		expect(screen.getByText("1 plan")).toBeVisible();
		expect(screen.getByText("file:///workspace/PLAN.md").tagName).toBe("CODE");
		expect(container.querySelector("a")).toBeNull();
	});

	it("keeps empty item and markdown plans visible alongside other projections", () => {
		render(
			<PlanIndicator
				plans={[
					{ type: "items", planId: "items", entries: [] },
					{ type: "markdown", planId: "markdown", content: "" },
					{ type: "file", planId: "file", uri: "file:///plan.md" },
				]}
			/>,
		);

		expect(screen.getByRole("button", { name: "Open 3 plans" })).toBeVisible();
		expect(screen.getByText("This plan has no tasks.")).toBeVisible();
		expect(screen.getByText("This plan is empty.")).toBeVisible();
		expect(screen.getAllByText(/^(items|markdown|file)$/)).toHaveLength(3);
	});

	it("renders hostile markdown without URL-bearing nodes or side effects", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
		const createObjectURLSpy = vi.fn();
		Object.defineProperty(URL, "createObjectURL", {
			configurable: true,
			value: createObjectURLSpy,
		});
		const hostileMarkdown = [
			"# Safe heading",
			"[unsafe link](javascript:alert(1))",
			"![remote image](https://example.com/image.png)",
			'<a href="https://example.com/raw">raw link</a>',
			'<img src="https://example.com/raw.png">',
			"```mermaid",
			"graph TD; A-->B",
			"```",
			"```madeuplang",
			"payload",
			"```",
		].join("\n\n");

		const { container } = render(
			<PlanIndicator
				plans={[
					{
						type: "markdown",
						planId: "hostile",
						content: hostileMarkdown,
					},
				]}
			/>,
		);

		await screen.findByRole("heading", { name: "Safe heading" });
		await waitFor(() => {
			expect(
				container.querySelectorAll("a, img, iframe, [href], [src]"),
			).toHaveLength(0);
		});
		expect(screen.getByText("unsafe link")).toBeVisible();
		expect(screen.getByText("remote image")).toBeVisible();
		expect(screen.getByText("graph TD; A-->B")).toBeVisible();
		expect(screen.getByText("payload")).toBeVisible();
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(openSpy).not.toHaveBeenCalled();
		expect(createObjectURLSpy).not.toHaveBeenCalled();

		openSpy.mockRestore();
		vi.unstubAllGlobals();
		Reflect.deleteProperty(URL, "createObjectURL");
	});
});
