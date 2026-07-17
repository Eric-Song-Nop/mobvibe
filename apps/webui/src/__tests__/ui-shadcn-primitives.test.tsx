import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
	ToggleGroup,
	ToggleGroupItem,
} from "@mobvibe/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

describe("shared shadcn primitives", () => {
	it("provides a structured empty state", () => {
		const { container } = render(
			<Empty>
				<EmptyHeader>
					<EmptyTitle>No sessions</EmptyTitle>
					<EmptyDescription>Start a session to continue.</EmptyDescription>
				</EmptyHeader>
			</Empty>,
		);

		expect(container.querySelector('[data-slot="empty"]')).toBeInTheDocument();
		expect(
			container.querySelector('[data-slot="empty-description"]'),
		).toHaveTextContent("Start a session to continue.");
	});

	it("provides an accessible single-select toggle group", async () => {
		const user = userEvent.setup();
		render(
			<ToggleGroup type="single" defaultValue="en" aria-label="Language">
				<ToggleGroupItem value="en">English</ToggleGroupItem>
				<ToggleGroupItem value="zh">中文</ToggleGroupItem>
			</ToggleGroup>,
		);

		const chinese = screen.getByRole("radio", { name: "中文" });
		await user.click(chinese);

		expect(chinese).toHaveAttribute("data-state", "on");
	});
});
