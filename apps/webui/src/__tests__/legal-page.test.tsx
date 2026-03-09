import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import "@/i18n";
import { LegalPage } from "@/pages/LegalPage";
import { LoginPage } from "@/pages/LoginPage";

const signInEmail = vi.fn();
const signUpEmail = vi.fn();
const sendVerificationEmail = vi.fn();

vi.mock("@/components/auth/AuthProvider", () => ({
	useAuth: () => ({
		signIn: { email: signInEmail },
		signUp: { email: signUpEmail },
	}),
}));

vi.mock("@/lib/auth", () => ({
	sendVerificationEmail: (...args: unknown[]) => sendVerificationEmail(...args),
}));

describe("Legal surfaces", () => {
	beforeEach(() => {
		signInEmail.mockReset();
		signUpEmail.mockReset();
		sendVerificationEmail.mockReset();
	});

	it("renders bilingual legal content and policy navigation", () => {
		render(
			<MemoryRouter>
				<LegalPage documentId="privacy" />
			</MemoryRouter>,
		);

		expect(
			screen.getAllByRole("heading", { name: "Privacy Policy" }).length,
		).toBeGreaterThan(0);
		expect(
			screen.getAllByRole("heading", { name: "隐私政策" }).length,
		).toBeGreaterThan(0);
		expect(
			screen.getByRole("link", { name: "Terms of Service" }),
		).toHaveAttribute("href", "/terms");
		expect(screen.getByRole("link", { name: "Refund Policy" })).toHaveAttribute(
			"href",
			"/refund",
		);
		expect(screen.getByText("March 9, 2026")).toBeInTheDocument();
		expect(screen.getByText("2026年3月9日")).toBeInTheDocument();
	});

	it("shows public legal links on the login page", () => {
		render(
			<MemoryRouter initialEntries={["/login"]}>
				<LoginPage />
			</MemoryRouter>,
		);

		expect(
			screen.getByRole("link", { name: "Privacy Policy" }),
		).toHaveAttribute("href", "/privacy");
		expect(
			screen.getByRole("link", { name: "Terms of Service" }),
		).toHaveAttribute("href", "/terms");
		expect(screen.getByRole("link", { name: "Refund Policy" })).toHaveAttribute(
			"href",
			"/refund",
		);
	});
});
