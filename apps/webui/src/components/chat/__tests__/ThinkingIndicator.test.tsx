import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThinkingIndicator } from "../ThinkingIndicator";

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) =>
			key === "chat.agentThinking"
				? "Agent is thinking"
				: "Agent is responding",
	}),
}));

describe("ThinkingIndicator", () => {
	it("uses the marker primitive and an accessible status label", () => {
		render(<ThinkingIndicator isThinking />);

		const indicator = screen.getByLabelText("Agent is thinking");
		expect(indicator).toHaveAttribute("data-slot", "marker");
		expect(indicator).toHaveTextContent(/…$/);
		expect(indicator).not.toHaveTextContent("...");
	});
});
