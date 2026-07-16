import { SidebarProvider } from "@mobvibe/ui/sidebar";
import { ThemeProvider } from "@mobvibe/ui/theme-provider";
import { ToggleGroup, ToggleGroupItem } from "@mobvibe/ui/toggle-group";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";
import { DemoFooter } from "@/components/DemoFooter";
import { DemoHeader } from "@/components/DemoHeader";
import { DemoMessageList } from "@/components/DemoMessageList";
import { DemoSidebar } from "@/components/DemoSidebar";
import { GetStartedDialog } from "@/components/GetStartedDialog";
import i18n from "@/i18n";

const renderWithTheme = (node: React.ReactNode) =>
	render(<ThemeProvider defaultTheme="light">{node}</ThemeProvider>);

describe("website interaction semantics", () => {
	beforeEach(async () => {
		await i18n.changeLanguage("en");
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 1024,
		});
	});

	it("uses one interactive element for links styled as buttons", async () => {
		const header = render(<DemoHeader currentPathname="/" />);
		expect(header.container.querySelector("a button")).toBeNull();
		header.unmount();

		const sidebar = renderWithTheme(
			<SidebarProvider>
				<DemoSidebar
					groups={[]}
					activeFeatureId=""
					onFeatureSelect={() => {}}
				/>
			</SidebarProvider>,
		);
		expect(sidebar.container.querySelector("a button")).toBeNull();
	});

	it("uses a regular dialog for the non-destructive onboarding flow", async () => {
		const user = userEvent.setup();
		render(
			<GetStartedDialog>
				<button type="button">Open onboarding</button>
			</GetStartedDialog>,
		);

		await user.click(screen.getByRole("button", { name: "Open onboarding" }));

		expect(screen.getByRole("dialog")).toBeInTheDocument();
		expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
		expect(document.querySelector("a button")).toBeNull();
	});

	it("gives the demo composer an accessible name and native form metadata", () => {
		render(<DemoFooter />);
		const composer = screen.getByRole("textbox");

		expect(composer).toHaveAccessibleName();
		expect(composer).toHaveAttribute("name", "demo-message");
		expect(composer).toHaveAttribute("autocomplete", "off");
		expect(composer).toHaveAttribute("placeholder", "Start your own session…");
	});

	it("offers a skip link on the marketing page", () => {
		renderWithTheme(<App pathname="/" />);

		expect(
			screen.getByRole("link", { name: "Skip to main content" }),
		).toHaveAttribute("href", "#main-content");
		expect(document.querySelector("main#main-content")).not.toBeNull();
	});

	it("keeps the document language aligned with the translated UI", async () => {
		await i18n.changeLanguage("zh");
		expect(document.documentElement).toHaveAttribute("lang", "zh");

		await i18n.changeLanguage("en");
		expect(document.documentElement).toHaveAttribute("lang", "en");
	});

	it("uses a modal sidebar on mobile that closes with Escape", async () => {
		const user = userEvent.setup();
		Object.defineProperty(window, "innerWidth", {
			configurable: true,
			value: 375,
		});
		renderWithTheme(<App pathname="/" />);

		await user.click(screen.getByRole("button", { name: "Toggle menu" }));

		expect(
			screen.getByRole("dialog", { name: "Feature navigation" }),
		).toBeInTheDocument();
		await user.keyboard("{Escape}");
		expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
	});

	it("keeps a visible desktop control available after collapsing the sidebar", async () => {
		const user = userEvent.setup();
		renderWithTheme(<App pathname="/" />);

		const toggle = screen.getByRole("button", { name: "Toggle menu" });
		expect(toggle).not.toHaveClass("md:hidden");

		await user.click(toggle);

		expect(
			document.querySelector('[data-slot="sidebar"][data-state]'),
		).toHaveAttribute("data-state", "collapsed");
		expect(screen.getByRole("button", { name: "Toggle menu" })).toBeVisible();
	});

	it("exposes the selected language through toggle-group semantics", () => {
		renderWithTheme(<DemoHeader currentPathname="/pricing" />);

		const englishToggles = screen.getAllByRole("radio", { name: "English" });
		expect(englishToggles.length).toBeGreaterThan(0);
		for (const toggle of englishToggles) {
			expect(toggle).toHaveAttribute("aria-checked", "true");
		}
	});

	it("keeps horizontal toggle-group keyboard navigation on the horizontal axis", async () => {
		const user = userEvent.setup();
		render(
			<ToggleGroup type="single" orientation="horizontal">
				<ToggleGroupItem value="first">First</ToggleGroupItem>
				<ToggleGroupItem value="second">Second</ToggleGroupItem>
			</ToggleGroup>,
		);

		const first = screen.getByRole("radio", { name: "First" });
		const second = screen.getByRole("radio", { name: "Second" });
		await user.click(first);

		await user.keyboard("{ArrowDown}");
		expect(first).toHaveFocus();

		await user.keyboard("{ArrowRight}");
		expect(second).toHaveFocus();
	});

	it("reports clipboard failures instead of leaking a rejected promise", async () => {
		const user = userEvent.setup();
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: {
				writeText: vi.fn().mockRejectedValue(new Error("permission denied")),
			},
		});
		render(
			<GetStartedDialog>
				<button type="button">Open onboarding</button>
			</GetStartedDialog>,
		);

		await user.click(screen.getByRole("button", { name: "Open onboarding" }));
		await user.click(screen.getByRole("button", { name: "Copy command" }));

		expect(await screen.findByRole("alert")).toHaveTextContent(
			"Copy failed. Select and copy the command manually.",
		);
	});

	it("avoids smooth auto-scroll when reduced motion is requested", () => {
		const scrollIntoView = vi
			.spyOn(Element.prototype, "scrollIntoView")
			.mockImplementation(() => {});
		const originalMatchMedia = window.matchMedia;
		window.matchMedia = vi.fn((query: string) =>
			Object.assign(originalMatchMedia(query), {
				matches: query === "(prefers-reduced-motion: reduce)",
			}),
		);

		render(
			<DemoMessageList
				messages={[{ role: "assistant", content: "Hello", isStreaming: false }]}
			/>,
		);

		expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto" });
		window.matchMedia = originalMatchMedia;
		scrollIntoView.mockRestore();
	});

	it("composes demo chat rows from the shared message and bubble primitives", async () => {
		const { container } = render(
			<DemoMessageList
				messages={[
					{ role: "user", content: "Question", isStreaming: false },
					{ role: "assistant", content: "Answer", isStreaming: false },
				]}
			/>,
		);

		await waitFor(() => {
			expect(container.querySelectorAll('[data-slot="message"]')).toHaveLength(
				2,
			);
		});
		expect(container.querySelectorAll('[data-slot="bubble"]')).toHaveLength(2);
	});
});
