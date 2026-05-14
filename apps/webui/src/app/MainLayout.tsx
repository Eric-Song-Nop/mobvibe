import { AppDialogs } from "@/app/AppDialogs";
import { SessionWorkspace } from "@/app/SessionWorkspace";
import type { MainAppController } from "@/app/use-main-app-controller";
import { AppSidebar } from "@/components/app/AppSidebar";
import { MachinesSidebar } from "@/components/machines/MachinesSidebar";
import { Toaster } from "@/components/ui/toaster";

type MainLayoutProps = {
	controller: MainAppController;
};

export function MainLayout({ controller }: MainLayoutProps) {
	const {
		activeSessionId,
		activeAgentTeamId,
		handleArchiveSession,
		handleBulkArchiveSessions,
		handleOpenCreateDialog,
		handleRenameSubmit,
		handleSelectSession,
		handleSelectAgentTeam,
		isBulkArchiving,
		isCreatingSession,
		mutationsSnapshot,
		sessionList,
		sidebarSessionList,
	} = controller;

	return (
		<div className="app-root bg-muted/40 text-foreground flex flex-col overflow-hidden md:flex-row">
			<Toaster />
			<AppDialogs controller={controller} />

			<MachinesSidebar />

			<AppSidebar
				sessions={sessionList}
				sidebarEntries={sidebarSessionList}
				activeSessionId={activeSessionId}
				activeAgentTeamId={activeAgentTeamId}
				onCreateSession={handleOpenCreateDialog}
				onSelectSession={handleSelectSession}
				onSelectAgentTeam={handleSelectAgentTeam}
				onEditSubmit={handleRenameSubmit}
				onArchiveSession={(sessionId) => {
					void handleArchiveSession(sessionId);
				}}
				onArchiveAllSessions={(sessionIds) => {
					void handleBulkArchiveSessions(sessionIds);
				}}
				isBulkArchiving={isBulkArchiving}
				isCreating={isCreatingSession}
				mutations={mutationsSnapshot}
			/>

			<SessionWorkspace controller={controller} />
		</div>
	);
}
