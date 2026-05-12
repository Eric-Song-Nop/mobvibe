import { Separator } from "@mobvibe/ui/separator";
import type { MainAppController } from "@/app/use-main-app-controller";
import { AppHeader } from "@/components/app/AppHeader";
import { ChatFooter } from "@/components/app/ChatFooter";
import { ChatMessageList } from "@/components/app/ChatMessageList";
import { ChatSearchBar } from "@/components/chat/ChatSearchBar";

type SessionWorkspaceProps = {
	controller: MainAppController;
};

export function SessionWorkspace({ controller }: SessionWorkspaceProps) {
	const {
		activeSession,
		activeSessionId,
		backendLabel,
		chatMessageListRef,
		chatSearchOpen,
		contextLeftPercent,
		executionMode,
		fileExplorerAvailable,
		forceReloadDisabled,
		handleCancel,
		handleForceReload,
		handleModeChange,
		handleModelChange,
		handleOpenCreateDialog,
		handlePermissionDecision,
		handleScrollToMessage,
		handleSend,
		handleSyncHistory,
		isModeSwitching,
		isModelSwitching,
		loadingMessage,
		plan,
		selectedMachineId,
		statusMessage,
		streamError,
		subdirectoryLabel,
		syncHistoryAvailable,
		syncHistoryDisabled,
		uiActions,
		warningMessage,
		workspaceLabel,
		workspaceRootCwd,
	} = controller;

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
			<AppHeader
				backendLabel={backendLabel}
				workspaceLabel={workspaceLabel}
				workspacePath={workspaceRootCwd}
				executionMode={activeSession ? executionMode : undefined}
				branchLabel={activeSession?.worktreeBranch}
				subdirectoryLabel={subdirectoryLabel}
				contextLeftPercent={contextLeftPercent}
				statusMessage={statusMessage}
				warningMessage={warningMessage}
				streamError={streamError}
				loadingMessage={loadingMessage}
				plan={plan}
				onOpenMobileMenu={() => uiActions.setMobileMenuOpen(true)}
				onOpenFileExplorer={() => uiActions.setFileExplorerOpen(true)}
				onOpenCommandPalette={() => uiActions.setCommandPaletteOpen(true)}
				onSyncHistory={handleSyncHistory}
				onForceReload={handleForceReload}
				showFileExplorer={fileExplorerAvailable}
				showSyncHistory={syncHistoryAvailable}
				showForceReload={Boolean(activeSessionId)}
				syncHistoryDisabled={syncHistoryDisabled}
				forceReloadDisabled={forceReloadDisabled}
			/>
			<ChatSearchBar
				open={chatSearchOpen}
				onOpenChange={uiActions.setChatSearchOpen}
				messages={activeSession?.messages ?? []}
				onScrollToMessage={handleScrollToMessage}
			/>
			<ChatMessageList
				ref={chatMessageListRef}
				activeSession={activeSession}
				loadingMessage={loadingMessage}
				hasMachineSelected={Boolean(selectedMachineId)}
				onCreateSession={handleOpenCreateDialog}
				onPermissionDecision={handlePermissionDecision}
			/>
			<Separator />
			<ChatFooter
				activeSession={activeSession}
				activeSessionId={activeSessionId}
				isModeSwitching={isModeSwitching}
				isModelSwitching={isModelSwitching}
				onModeChange={handleModeChange}
				onModelChange={handleModelChange}
				onSend={handleSend}
				onCancel={handleCancel}
			/>
		</div>
	);
}
