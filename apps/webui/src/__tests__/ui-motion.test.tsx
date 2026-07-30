import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Button } from "@mobvibe/ui/button";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("shared UI motion", () => {
	it("limits button transitions to properties that actually animate", () => {
		render(<Button>Continue</Button>);

		const className = screen.getByRole("button").className;
		expect(className).not.toContain("transition-all");
		expect(className).toContain(
			"transition-[color,background-color,border-color,box-shadow,opacity,transform]",
		);
	});

	it("disables non-essential shared animation for reduced-motion users", () => {
		const styles = readFileSync(
			resolve(process.cwd(), "../../packages/ui/src/styles.css"),
			"utf8",
		);

		expect(styles).toMatch(
			/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration:\s*0\.01ms/,
		);
		expect(styles).toMatch(
			/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition-duration:\s*0\.01ms/,
		);
	});
});
