import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
	AgentTeamLifecycle,
	AgentTeamSummary,
	AgentTeamsChangedPayload,
	CreateAgentTeamRpcParams,
	CreateAgentTeamRpcResult,
	CreateSessionWorktreeOptions,
	GetAgentTeamRpcParams,
	GetAgentTeamRpcResult,
	ListAgentTeamsRpcResult,
	SessionSummary,
	TeamMcpPhase,
	TeamMemberLifecycle,
	TeamMemberSummary,
	TeamSourceRef,
} from "../src/index.js";

type IsEqual<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

type Assert<T extends true> = T;

type ExpectedTeamLifecycle =
	| "pending"
	| "starting"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "archived";

type ExpectedMemberLifecycle =
	| "pending"
	| "creating_session"
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "detached"
	| "archived";

type _TeamLifecycleMatchesPlan = Assert<
	IsEqual<AgentTeamLifecycle, ExpectedTeamLifecycle>
>;

type _MemberLifecycleMatchesPlan = Assert<
	IsEqual<TeamMemberLifecycle, ExpectedMemberLifecycle>
>;

describe("Agent Team shared contract", () => {
	it("exports gateway-facing projection, source-ref, MCP, and RPC types", () => {
		expectTypeOf<AgentTeamSummary>().toMatchTypeOf<{
			agentTeamId: string;
			lifecycle: AgentTeamLifecycle;
			members: TeamMemberSummary[];
		}>();
		expectTypeOf<TeamMcpPhase>().toEqualTypeOf<
			| "not_started"
			| "server_starting"
			| "server_ready"
			| "session_injecting"
			| "tools_waiting"
			| "tools_ready"
			| "degraded"
			| "error"
		>();
		expectTypeOf<TeamSourceRef>().toMatchTypeOf<
			| { type: "session_event"; agentTeamId: string }
			| { type: "member_session"; agentTeamId: string }
			| { type: "mailbox_message"; agentTeamId: string }
			| { type: "task"; agentTeamId: string }
		>();
		expectTypeOf<CreateAgentTeamRpcParams>().toMatchTypeOf<{
			machineId: string;
			backendId: string;
			workspaceRootCwd: string;
			worktree?: CreateSessionWorktreeOptions;
		}>();
		expectTypeOf<CreateAgentTeamRpcResult>().toMatchTypeOf<{
			team: AgentTeamSummary;
			leaderSession?: SessionSummary;
		}>();
		expectTypeOf<ListAgentTeamsRpcResult>().toMatchTypeOf<{
			teams: AgentTeamSummary[];
		}>();
		expectTypeOf<GetAgentTeamRpcParams>().toMatchTypeOf<{
			agentTeamId: string;
		}>();
		expectTypeOf<GetAgentTeamRpcResult>().toEqualTypeOf<{
			team?: AgentTeamSummary;
		}>();
		expectTypeOf<AgentTeamsChangedPayload>().toMatchTypeOf<{
			added: AgentTeamSummary[];
			updated: AgentTeamSummary[];
			removed: string[];
			machineId?: string;
		}>();
	});

	it("keeps forbidden plaintext and secret field names out of gateway-facing team source", () => {
		const source = readFileSync(
			resolve(import.meta.dirname, "../src/types/agent-team.ts"),
			"utf8",
		)
			.split("\n")
			.filter((line) => !line.trimStart().startsWith("//"))
			.join("\n");

			expect(source).not.toMatch(
			/\b(prompt|content|body|description|summaryText|agentOutput|providerToken|masterSecret|dek|secret)\b/,
		);
	});

	it("keeps Agent Team create metadata extensible without target plaintext", () => {
		const source = readFileSync(
			resolve(import.meta.dirname, "../src/types/agent-team.ts"),
			"utf8",
		);

		expect(source).toMatch(/worktree\?: CreateSessionWorktreeOptions/);
		expect(source).toMatch(/leaderSession\?: SessionSummary/);
		expect(source).not.toMatch(/target\?:/);
	});
});
