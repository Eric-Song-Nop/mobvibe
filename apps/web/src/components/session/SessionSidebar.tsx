import {
	ComputerIcon,
	MoonIcon,
	PaintBoardIcon,
	SunIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { type ChatSession } from "@/lib/chat-store";
import { getStatusVariant } from "@/lib/ui-utils";
import { cn } from "@/lib/utils";

type SessionSidebarProps = {
	sessions: ChatSession[];
	activeSessionId?: string;
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
	themePreference: "light" | "dark" | "system";
	onThemePreferenceChange: (value: "light" | "dark" | "system") => void;
};

export const SessionSidebar = ({
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
	themePreference,
	onThemePreferenceChange,
}: SessionSidebarProps) => {
	return (
		<div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
			<div className="flex items-center justify-between">
				<div className="text-sm font-semibold">对话</div>
				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="icon-sm" aria-label="切换主题">
								<HugeiconsIcon icon={PaintBoardIcon} strokeWidth={2} />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-40">
							<DropdownMenuLabel>主题</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={themePreference}
								onValueChange={onThemePreferenceChange}
							>
								<DropdownMenuRadioItem value="light">
									<HugeiconsIcon icon={SunIcon} strokeWidth={2} />
									浅色
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="dark">
									<HugeiconsIcon icon={MoonIcon} strokeWidth={2} />
									深色
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="system">
									<HugeiconsIcon icon={ComputerIcon} strokeWidth={2} />
									跟随系统
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button onClick={onCreateSession} size="sm" disabled={isCreating}>
						新建
					</Button>
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
				{sessions.length === 0 ? (
					<div className="text-muted-foreground text-xs">暂无对话</div>
				) : null}
				{sessions.map((session) => (
					<SessionListItem
						key={session.sessionId}
						session={session}
						isActive={session.sessionId === activeSessionId}
						isEditing={session.sessionId === editingSessionId}
						editingTitle={editingTitle}
						onSelect={onSelectSession}
						onEdit={onEditSession}
						onEditCancel={onEditCancel}
						onEditSubmit={onEditSubmit}
						onEditingTitleChange={onEditingTitleChange}
						onClose={onCloseSession}
					/>
				))}
			</div>
		</div>
	);
};

type SessionListItemProps = {
	session: ChatSession;
	isActive: boolean;
	isEditing: boolean;
	editingTitle: string;
	onSelect: (sessionId: string) => void;
	onEdit: (session: ChatSession) => void;
	onEditCancel: () => void;
	onEditSubmit: () => void;
	onEditingTitleChange: (value: string) => void;
	onClose: (sessionId: string) => void;
};

const SessionListItem = ({
	session,
	isActive,
	isEditing,
	editingTitle,
	onSelect,
	onEdit,
	onEditCancel,
	onEditSubmit,
	onEditingTitleChange,
	onClose,
}: SessionListItemProps) => {
	const statusVariant = getStatusVariant(session.state);
	const backendLabel = session.backendLabel ?? session.backendId;
	const handleSelect = () => onSelect(session.sessionId);
	return (
		<div
			className={cn(
				"border-border bg-background hover:bg-muted flex flex-col gap-2 rounded-none border p-2 text-left cursor-pointer",
				isActive ? "border-primary/40" : "",
			)}
			onClick={handleSelect}
		>
			<div
				role="button"
				tabIndex={0}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						handleSelect();
					}
				}}
				className="flex flex-1 flex-col gap-1"
			>
				<div className="flex items-center justify-between gap-2">
					{isEditing ? (
						<Input
							value={editingTitle}
							onChange={(event) => onEditingTitleChange(event.target.value)}
							onClick={(event) => event.stopPropagation()}
							onKeyDown={(event) => event.stopPropagation()}
							className="h-7 text-xs"
						/>
					) : (
						<span className="text-sm font-medium">{session.title}</span>
					)}
					<div className="flex items-center gap-2">
						<Badge variant={statusVariant}>{session.state ?? "idle"}</Badge>
						{backendLabel ? (
							<Badge variant="outline">{backendLabel}</Badge>
						) : null}
					</div>
				</div>
				{session.error ? (
					<span className="text-destructive text-xs">
						{session.error.message}
					</span>
				) : null}
			</div>
			<div
				className="flex items-center gap-2"
				onClick={(event) => event.stopPropagation()}
			>
				{isEditing ? (
					<>
						<Button size="xs" onClick={onEditSubmit}>
							保存
						</Button>
						<Button size="xs" variant="outline" onClick={onEditCancel}>
							取消
						</Button>
					</>
				) : (
					<Button size="xs" variant="ghost" onClick={() => onEdit(session)}>
						改名
					</Button>
				)}
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button size="xs" variant="destructive">
							关闭
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent size="sm">
						<AlertDialogHeader>
							<AlertDialogTitle>关闭对话？</AlertDialogTitle>
							<AlertDialogDescription>
								关闭后将断开后端会话进程，前端仍保留消息记录。
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>取消</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => onClose(session.sessionId)}
							>
								确认关闭
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
};
