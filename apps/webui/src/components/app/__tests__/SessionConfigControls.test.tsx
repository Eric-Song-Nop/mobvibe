import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
	ButtonHTMLAttributes,
	InputHTMLAttributes,
	ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import type { SessionConfigOption } from "@/lib/acp";
import { SessionConfigControls } from "../SessionConfigControls";

vi.mock("@hugeicons/react", () => ({
	HugeiconsIcon: () => <span aria-hidden="true" />,
}));

vi.mock("@hugeicons/core-free-icons", () => ({
	Settings02Icon: {},
}));

vi.mock("react-i18next", () => ({
	useTranslation: () => ({
		t: (key: string) =>
			({
				"chat.sessionConfig": "Session settings",
				"chat.sessionConfigDescription": "Configure this agent session.",
				"chat.sessionConfigCategoryModel": "Model",
				"chat.sessionConfigCategoryThoughtLevel": "Reasoning",
				"chat.sessionConfigCategoryOther": "Other",
				"chat.updatingSessionConfig": "Updating session settings…",
			})[key] ?? key,
	}),
}));

vi.mock("@mobvibe/ui/button", () => ({
	Button: ({
		children,
		size: _size,
		variant: _variant,
		...props
	}: ButtonHTMLAttributes<HTMLButtonElement> & {
		size?: string;
		variant?: string;
	}) => <button {...props}>{children}</button>,
}));

vi.mock("@mobvibe/ui/popover", () => ({
	Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
	PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
	PopoverContent: ({ children }: { children: ReactNode }) => (
		<div data-testid="popover-content">{children}</div>
	),
}));

vi.mock("@mobvibe/ui/checkbox", () => ({
	Checkbox: ({
		checked,
		onCheckedChange,
		...props
	}: Omit<InputHTMLAttributes<HTMLInputElement>, "checked" | "onChange"> & {
		checked: boolean;
		onCheckedChange: (checked: boolean) => void;
	}) => (
		<input
			type="checkbox"
			checked={checked}
			onChange={(event) => onCheckedChange(event.currentTarget.checked)}
			{...props}
		/>
	),
}));

vi.mock("@mobvibe/ui/select", async () => {
	const React = await vi.importActual<typeof import("react")>("react");
	const SelectContext = React.createContext<{
		disabled?: boolean;
		onValueChange?: (value: string) => void;
	}>({});
	return {
		Select: ({
			children,
			disabled,
			onValueChange,
		}: {
			children: ReactNode;
			disabled?: boolean;
			onValueChange?: (value: string) => void;
		}) => (
			<SelectContext.Provider value={{ disabled, onValueChange }}>
				{children}
			</SelectContext.Provider>
		),
		SelectTrigger: ({
			children,
			size: _size,
			...props
		}: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) => {
			const context = React.useContext(SelectContext);
			return (
				<button type="button" disabled={context.disabled} {...props}>
					{children}
				</button>
			);
		},
		SelectValue: ({ children }: { children: ReactNode }) => <>{children}</>,
		SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
		SelectGroup: ({ children }: { children: ReactNode }) => (
			<div>{children}</div>
		),
		SelectLabel: ({ children }: { children: ReactNode }) => (
			<div>{children}</div>
		),
		SelectItem: ({
			children,
			value,
		}: {
			children: ReactNode;
			value: string;
		}) => {
			const context = React.useContext(SelectContext);
			return (
				<button
					type="button"
					role="option"
					data-value={value}
					disabled={context.disabled}
					onClick={() => context.onValueChange?.(value)}
				>
					{children}
				</button>
			);
		},
	};
});

const options: SessionConfigOption[] = [
	{
		type: "select",
		id: "model",
		name: "Model selector",
		category: "model",
		currentValue: "fast",
		options: [
			{ value: "fast", name: "Fast" },
			{ value: "balanced", name: "Balanced" },
		],
	},
	{
		type: "boolean",
		id: "safe-mode",
		name: "Safe mode",
		currentValue: false,
		description: "Require confirmation for risky actions.",
	},
	{
		type: "select",
		id: "reasoning",
		name: "Reasoning effort",
		category: "thought_level",
		currentValue: "high",
		options: [
			{
				group: "effort",
				name: "Effort",
				options: [{ value: "high", name: "High" }],
			},
		],
	},
	{
		type: "select",
		id: "custom id/with spaces",
		name: "Custom selector",
		category: "_vendor_feature",
		description: "Agent-specific setting.",
		currentValue: "on",
		options: [{ value: "on", name: "On" }],
	},
];

describe("SessionConfigControls", () => {
	it("preserves protocol order, renders grouped and unknown options, and dispatches typed values", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(<SessionConfigControls options={options} onChange={onChange} />);

		expect(
			screen.getByRole("button", { name: "Model selector" }),
		).toHaveTextContent("Fast");
		const settingsText =
			screen.getByTestId("popover-content").textContent ?? "";
		expect(settingsText.indexOf("Safe mode")).toBeLessThan(
			settingsText.indexOf("Reasoning effort"),
		);
		expect(settingsText.indexOf("Reasoning effort")).toBeLessThan(
			settingsText.indexOf("Custom selector"),
		);
		expect(screen.getByText("Effort")).toBeInTheDocument();
		expect(screen.getAllByText("Other")).not.toHaveLength(0);
		const customDescriptionId = screen
			.getByRole("button", { name: "Custom selector" })
			.getAttribute("aria-describedby");
		expect(customDescriptionId).not.toMatch(/\s/);
		expect(
			document.getElementById(customDescriptionId ?? "missing"),
		).toHaveTextContent("Agent-specific setting.");

		await user.click(screen.getByText("Safe mode"));
		await user.click(screen.getByRole("option", { name: "Balanced" }));

		expect(onChange).toHaveBeenNthCalledWith(1, "safe-mode", true);
		expect(onChange).toHaveBeenNthCalledWith(2, "model", "balanced");
	});

	it("reflects replacement state and announces a pending update", () => {
		const { rerender } = render(
			<SessionConfigControls options={options} onChange={vi.fn()} />,
		);
		const replacement: SessionConfigOption[] = [
			{
				type: "select",
				id: "model",
				name: "Model selector",
				category: "model",
				currentValue: "balanced",
				options: [
					{ value: "fast", name: "Fast" },
					{ value: "balanced", name: "Balanced" },
				],
			},
			options[1],
		];

		rerender(
			<SessionConfigControls
				options={replacement}
				pendingConfigId="model"
				onChange={vi.fn()}
			/>,
		);

		expect(
			screen.getByRole("button", { name: "Model selector" }),
		).toHaveTextContent("Balanced");
		expect(
			screen.getByRole("button", { name: "Model selector" }),
		).toBeDisabled();
		expect(screen.getByRole("checkbox", { name: "Safe mode" })).toBeDisabled();
		expect(screen.getByRole("status")).toHaveTextContent(
			"Updating session settings…",
		);
	});

	it("round-trips an empty protocol value through a non-empty select value", async () => {
		const user = userEvent.setup();
		const onChange = vi.fn();
		render(
			<SessionConfigControls
				options={[
					{
						type: "select",
						id: "model",
						name: "Model selector",
						category: "model",
						currentValue: "named",
						options: [
							{ value: "", name: "Agent default" },
							{ value: "named", name: "Named" },
						],
					},
				]}
				onChange={onChange}
			/>,
		);

		const emptyOption = screen.getByRole("option", { name: "Agent default" });
		expect(emptyOption).toHaveAttribute("data-value", "acp:");
		await user.click(emptyOption);
		expect(onChange).toHaveBeenCalledWith("model", "");
	});
});
