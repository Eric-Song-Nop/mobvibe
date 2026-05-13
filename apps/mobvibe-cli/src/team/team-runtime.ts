import type { AgentTeamStore } from "./agent-team-store.js";
import { TeamMcpRouter } from "./team-mcp-router.js";
import { TeamToolHandlers, type TeamToolHandlersOptions } from "./team-tool-handlers.js";

export type TeamRuntimeOptions = Omit<TeamToolHandlersOptions, "store"> & {
	store: AgentTeamStore;
};

export class TeamRuntime {
	readonly toolHandlers: TeamToolHandlers;
	readonly mcpRouter: TeamMcpRouter;

	constructor(options: TeamRuntimeOptions) {
		this.toolHandlers = new TeamToolHandlers({
			store: options.store,
			requestPermission: options.requestPermission,
			services: options.services,
		});
		this.mcpRouter = new TeamMcpRouter({
			store: options.store,
			handlers: this.toolHandlers,
		});
	}
}
