import { SessionSidebar } from "@/components/session/SessionSidebar";
import type { ChatSession } from "@/lib/chat-store";

export type AppSidebarProps = {
	sessions: ChatSession[];
	activeSessionId: string | undefined;
	editingSessionId: string | null;
	editingTitle: string;
	onCreateSession: () => void;
	onSelectSession: (sessionId: string) => void;
	onEditSession: (session: ChatSession) => void;
	onEditCancel: () => void;
	onEditSubmit: () => void;
	onEditingTitleChange: (value: string) => void;
	onCloseSession: (sessionId: string) => void;
	isCreating: boolean;
	mobileOpen: boolean;
	onMobileOpenChange: (open: boolean) => void;
	themePreference: "light" | "dark" | "system";
	onThemePreferenceChange: (value: "light" | "dark" | "system") => void;
};

export function AppSidebar({
	sessions,
	activeSessionId,
	editingSessionId,
	editingTitle,
	onCreateSession,
	onSelectSession,
	onEditSession,
	onEditCancel,
	onEditSubmit,
	onEditingTitleChange,
	onCloseSession,
	isCreating,
	mobileOpen,
	onMobileOpenChange,
	themePreference,
	onThemePreferenceChange,
}: AppSidebarProps) {
	return (
		<>
			<aside className="bg-background/80 border-r hidden w-64 flex-col px-4 py-4 md:flex min-h-0 overflow-hidden">
				<SessionSidebar
					sessions={sessions}
					activeSessionId={activeSessionId}
					editingSessionId={editingSessionId}
					editingTitle={editingTitle}
					onCreateSession={onCreateSession}
					onSelectSession={onSelectSession}
					onEditSession={onEditSession}
					onEditCancel={onEditCancel}
					onEditSubmit={onEditSubmit}
					onEditingTitleChange={onEditingTitleChange}
					onCloseSession={onCloseSession}
					isCreating={isCreating}
					themePreference={themePreference}
					onThemePreferenceChange={onThemePreferenceChange}
				/>
			</aside>
			{mobileOpen ? (
				<div className="fixed inset-0 z-50 flex md:hidden">
					<div className="bg-background/90 border-r w-72 p-4 flex h-full flex-col overflow-hidden">
						<SessionSidebar
							sessions={sessions}
							activeSessionId={activeSessionId}
							editingSessionId={editingSessionId}
							editingTitle={editingTitle}
							onCreateSession={onCreateSession}
							onSelectSession={(sessionId) => {
								onSelectSession(sessionId);
								onMobileOpenChange(false);
							}}
							onEditSession={onEditSession}
							onEditCancel={onEditCancel}
							onEditSubmit={onEditSubmit}
							onEditingTitleChange={onEditingTitleChange}
							onCloseSession={onCloseSession}
							isCreating={isCreating}
							themePreference={themePreference}
							onThemePreferenceChange={(value) => {
								onThemePreferenceChange(value);
								onMobileOpenChange(false);
							}}
						/>
					</div>
					<button
						type="button"
						className="bg-black/30 flex-1"
						onClick={() => onMobileOpenChange(false)}
					/>
				</div>
			) : null}
		</>
	);
}
