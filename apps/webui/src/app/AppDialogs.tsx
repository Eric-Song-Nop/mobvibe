import { lazy, Suspense } from "react";
import type { MainAppController } from "@/app/use-main-app-controller";
import { CreateSessionDialog } from "@/components/app/CreateSessionDialog";
import { FileExplorerDialog } from "@/components/app/FileExplorerDialog";

const CommandPalette = lazy(async () => {
	const module = await import("@/components/app/CommandPalette");
	return { default: module.CommandPalette };
});

type AppDialogsProps = {
	controller: MainAppController;
};

export function AppDialogs({ controller }: AppDialogsProps) {
	const {
		activeSessionId,
		availableBackends,
		commandPaletteOpen,
		createDialogOpen,
		fileExplorerAvailable,
		fileExplorerOpen,
		filePreviewPath,
		handleCreateSession,
		isCreatingSession,
		uiActions,
	} = controller;

	return (
		<>
			<CreateSessionDialog
				open={createDialogOpen}
				onOpenChange={uiActions.setCreateDialogOpen}
				availableBackends={availableBackends}
				isCreating={isCreatingSession}
				onCreate={handleCreateSession}
			/>
			<FileExplorerDialog
				open={fileExplorerOpen && fileExplorerAvailable}
				onOpenChange={(isOpen) => {
					uiActions.setFileExplorerOpen(isOpen);
					if (!isOpen) {
						uiActions.setFilePreviewPath(undefined);
					}
				}}
				sessionId={activeSessionId}
				initialFilePath={filePreviewPath}
			/>
			<Suspense fallback={null}>
				<CommandPalette
					open={commandPaletteOpen}
					onOpenChange={uiActions.setCommandPaletteOpen}
				/>
			</Suspense>
		</>
	);
}
