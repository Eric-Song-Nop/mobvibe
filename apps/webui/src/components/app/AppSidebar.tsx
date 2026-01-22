import { SessionSidebar } from "@/components/session/SessionSidebar";
import type { ChatSession } from "@/lib/chat-store";
import { useUiStore } from "@/lib/ui-store";

export type AppSidebarProps = {
	sessions: ChatSession[];
	activeSessionId: string | undefined;
	onCreateSession: () => void;
	onSelectSession: (sessionId: string) => void;
	onEditSubmit: () => void;
	onCloseSession: (sessionId: string) => void;
	isCreating: boolean;
};

export function AppSidebar({
	sessions,
	activeSessionId,
	onCreateSession,
	onSelectSession,
	onEditSubmit,
	onCloseSession,
	isCreating,
}: AppSidebarProps) {
	const { mobileMenuOpen, setMobileMenuOpen } = useUiStore();
	return (
		<>
			<aside className="bg-background/80 border-r hidden w-64 flex-col px-4 py-4 md:flex min-h-0 overflow-hidden">
				<SessionSidebar
					sessions={sessions}
					activeSessionId={activeSessionId}
					onCreateSession={onCreateSession}
					onSelectSession={onSelectSession}
					onEditSubmit={onEditSubmit}
					onCloseSession={onCloseSession}
					isCreating={isCreating}
				/>
			</aside>
			{mobileMenuOpen ? (
				<div className="fixed inset-0 z-50 flex md:hidden">
					<div className="bg-background/90 border-r w-72 p-4 flex h-full flex-col overflow-hidden">
						<SessionSidebar
							sessions={sessions}
							activeSessionId={activeSessionId}
							onCreateSession={onCreateSession}
							onSelectSession={(sessionId) => {
								onSelectSession(sessionId);
								setMobileMenuOpen(false);
							}}
							onEditSubmit={onEditSubmit}
							onCloseSession={onCloseSession}
							isCreating={isCreating}
						/>
					</div>
					<button
						type="button"
						className="bg-black/30 flex-1"
						onClick={() => setMobileMenuOpen(false)}
					/>
				</div>
			) : null}
		</>
	);
}
