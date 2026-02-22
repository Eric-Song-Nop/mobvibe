import { describe, expect, it } from "vitest";
import type { ChatSession } from "@/lib/chat-store";
import { collectWorkspaces } from "@/lib/workspace-utils";

const makeSession = (
	id: string,
	overrides: Partial<ChatSession> = {},
): ChatSession =>
	({
		id,
		title: `Session ${id}`,
		cwd: "/home/user/project",
		machineId: "machine-1",
		backendId: "backend-1",
		backendLabel: "Backend",
		createdAt: "2024-01-01T00:00:00.000Z",
		updatedAt: "2024-01-01T00:00:00.000Z",
		messages: [],
		...overrides,
	}) as unknown as ChatSession;

describe("collectWorkspaces", () => {
	it("groups main repo session and worktree session under one workspace", () => {
		const sessions: Record<string, ChatSession> = {
			s1: makeSession("s1", { cwd: "/home/user/project" }),
			s2: makeSession("s2", {
				cwd: "/home/user/.mobvibe/worktrees/project/feat-branch",
				worktreeSourceCwd: "/home/user/project",
				worktreeBranch: "feat-branch",
			}),
		};

		const workspaces = collectWorkspaces(sessions);

		expect(workspaces).toHaveLength(1);
		expect(workspaces[0].cwd).toBe("/home/user/project");
		expect(workspaces[0].label).toBe("project");
	});

	it("uses worktreeSourceCwd as workspace cwd for pure worktree sessions", () => {
		const sessions: Record<string, ChatSession> = {
			s1: makeSession("s1", {
				cwd: "/home/user/.mobvibe/worktrees/myrepo/feat-x",
				worktreeSourceCwd: "/home/user/myrepo",
				worktreeBranch: "feat-x",
			}),
		};

		const workspaces = collectWorkspaces(sessions);

		expect(workspaces).toHaveLength(1);
		expect(workspaces[0].cwd).toBe("/home/user/myrepo");
		expect(workspaces[0].label).toBe("myrepo");
	});

	it("sessions without worktree field behave unchanged", () => {
		const sessions: Record<string, ChatSession> = {
			s1: makeSession("s1", { cwd: "/home/user/project-a" }),
			s2: makeSession("s2", { cwd: "/home/user/project-b" }),
		};

		const workspaces = collectWorkspaces(sessions);

		expect(workspaces).toHaveLength(2);
		const cwds = workspaces.map((w) => w.cwd);
		expect(cwds).toContain("/home/user/project-a");
		expect(cwds).toContain("/home/user/project-b");
	});

	it("filters by machineId when provided", () => {
		const sessions: Record<string, ChatSession> = {
			s1: makeSession("s1", {
				cwd: "/home/user/project",
				machineId: "machine-1",
			}),
			s2: makeSession("s2", {
				cwd: "/home/user/other",
				machineId: "machine-2",
			}),
		};

		const workspaces = collectWorkspaces(sessions, "machine-1");

		expect(workspaces).toHaveLength(1);
		expect(workspaces[0].cwd).toBe("/home/user/project");
	});

	it("skips sessions without cwd or machineId", () => {
		const sessions: Record<string, ChatSession> = {
			s1: makeSession("s1", { cwd: undefined }),
			s2: makeSession("s2", { machineId: undefined }),
		};

		const workspaces = collectWorkspaces(sessions);

		expect(workspaces).toHaveLength(0);
	});
});
