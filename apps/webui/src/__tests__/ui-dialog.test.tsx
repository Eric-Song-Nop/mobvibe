import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@mobvibe/ui/dialog";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("shared Dialog composition", () => {
	it("provides accessible header and footer composition", () => {
		render(
			<Dialog open>
				<DialogContent>
					<DialogHeader data-testid="dialog-header">
						<DialogTitle>Connection details</DialogTitle>
						<DialogDescription>Review this machine.</DialogDescription>
					</DialogHeader>
					<DialogFooter data-testid="dialog-footer">Actions</DialogFooter>
				</DialogContent>
			</Dialog>,
		);

		expect(
			screen.getByRole("dialog", { name: "Connection details" }),
		).toBeInTheDocument();
		expect(screen.getByTestId("dialog-header")).toHaveAttribute(
			"data-slot",
			"dialog-header",
		);
		expect(screen.getByTestId("dialog-footer")).toHaveAttribute(
			"data-slot",
			"dialog-footer",
		);
	});
});
