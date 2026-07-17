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
		handleArchiveSession,
		handleCloseSession,
		handleDeleteSession,
		handleBulkArchiveSessions,
		handleOpenCreateDialog,
		handleRenameSubmit,
		handleSelectSession,
		isBulkArchiving,
		deletingSessionId,
		isCreatingSession,
		mutationsSnapshot,
		sessionList,
	} = controller;

	return (
		<div className="app-root bg-muted/40 text-foreground flex flex-col overflow-hidden md:flex-row">
			<Toaster />
			<AppDialogs controller={controller} />

			<MachinesSidebar />

			<AppSidebar
				sessions={sessionList}
				activeSessionId={activeSessionId}
				onCreateSession={handleOpenCreateDialog}
				onSelectSession={handleSelectSession}
				onEditSubmit={handleRenameSubmit}
				onArchiveSession={(sessionId) => {
					void handleArchiveSession(sessionId);
				}}
				onCloseSession={(sessionId) => {
					void handleCloseSession(sessionId);
				}}
				onDeleteSession={handleDeleteSession}
				onArchiveAllSessions={(sessionIds) => {
					void handleBulkArchiveSessions(sessionIds);
				}}
				isBulkArchiving={isBulkArchiving}
				deletingSessionId={deletingSessionId}
				isCreating={isCreatingSession}
				mutations={mutationsSnapshot}
			/>

			<SessionWorkspace controller={controller} />
		</div>
	);
}
