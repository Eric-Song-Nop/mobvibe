import type { AgentTeamSummary } from "@mobvibe/shared";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import "@/i18n";
import { AgentTeamOverview } from "../AgentTeamOverview";

const createTeam = (): AgentTeamSummary => ({
	agentTeamId: "team-1",
	machineId: "machine-1",
	title: "Agent Team UI",
	workspaceRootCwd: "/repo",
	workspaceMode: "shared_workspace",
	leaderMemberId: "leader-1",
	lifecycle: "running",
	mailboxCounts: { unread: 2, wakePending: 1, wakeFailed: 0 },
	taskCounts: {
		todo: 1,
		inProgress: 1,
		blocked: 0,
		completed: 2,
		failed: 0,
		cancelled: 0,
	},
	members: [
		{
			memberId: "leader-1",
			agentTeamId: "team-1",
			role: "leader",
			name: "Leader",
			backendId: "claude",
			sessionId: "leader-session",
			lifecycle: "running",
			health: "healthy",
			mcp: {
				transport: "acp",
				phase: "tools_ready",
				updatedAt: "2026-05-14T00:02:00.000Z",
			},
			mailboxCounts: { unread: 1, wakePending: 0, wakeFailed: 0 },
			taskCounts: {
				todo: 0,
				inProgress: 1,
				blocked: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
			},
			pendingPermissionCount: 0,
			worktreeBranch: "team/ui",
			createdAt: "2026-05-14T00:00:00.000Z",
			updatedAt: "2026-05-14T00:02:00.000Z",
			error: {
				message: "safe leader error",
				code: "INTERNAL_ERROR",
				retryable: true,
				scope: "service",
			},
		},
	],
	summaryRefs: [
		{
			summaryRefId: "summary-1",
			agentTeamId: "team-1",
			status: "ready",
			sourceRefs: [],
			createdAt: "2026-05-14T00:00:00.000Z",
			updatedAt: "2026-05-14T00:02:00.000Z",
		},
	],
	createdAt: "2026-05-14T00:00:00.000Z",
	updatedAt: "2026-05-14T00:03:00.000Z",
	error: {
		message: "safe team error",
		code: "INTERNAL_ERROR",
		retryable: true,
		scope: "service",
	},
});

describe("AgentTeamOverview", () => {
	it("renders metadata-only team projection and omits content-like fields", async () => {
		const onSelectSession = vi.fn();
		const user = userEvent.setup();
		render(
			<AgentTeamOverview
				team={createTeam()}
				onSelectSession={onSelectSession}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Agent Team UI" }),
		).toBeInTheDocument();
		expect(screen.getByText("running")).toBeInTheDocument();
		expect(screen.getByText("/repo")).toBeInTheDocument();
		expect(screen.getByText("Leader")).toBeInTheDocument();
		expect(screen.getByText("tools_ready · acp")).toBeInTheDocument();
		expect(screen.getByText("team/ui")).toBeInTheDocument();
		expect(screen.getByText("safe team error")).toBeInTheDocument();
		expect(screen.getByText("Tasks 4")).toBeInTheDocument();
		expect(screen.getByText("Mail 3")).toBeInTheDocument();
		expect(screen.queryByText(/secret target body/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/mailbox body/i)).not.toBeInTheDocument();
		expect(screen.queryByText(/agent output/i)).not.toBeInTheDocument();

		await user.click(
			screen.getByRole("button", { name: /Open Leader session/ }),
		);

		expect(onSelectSession).toHaveBeenCalledWith("leader-session");
	});
});
