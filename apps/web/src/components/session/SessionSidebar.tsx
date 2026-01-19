import {
	ComputerIcon,
	MoonIcon,
	PaintBoardIcon,
	SunIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/theme-provider";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import i18n, { supportedLanguages } from "@/i18n";
import { type ChatSession } from "@/lib/chat-store";
import { useUiStore } from "@/lib/ui-store";
import { getStatusVariant } from "@/lib/ui-utils";
import { cn } from "@/lib/utils";

const toThemePreference = (value: string): "light" | "dark" | "system" => {
	switch (value) {
		case "light":
		case "dark":
		case "system":
			return value;
		default:
			return "system";
	}
};

type SessionSidebarProps = {
	sessions: ChatSession[];
	activeSessionId?: string;
	onCreateSession: () => void;
	onSelectSession: (sessionId: string) => void;
	onEditSubmit: () => void;
	onCloseSession: (sessionId: string) => void;
	isCreating: boolean;
};

export const SessionSidebar = ({
	sessions,
	activeSessionId,
	onCreateSession,
	onSelectSession,
	onEditSubmit,
	onCloseSession,
	isCreating,
}: SessionSidebarProps) => {
	const { t } = useTranslation();
	const { theme, setTheme } = useTheme();
	const {
		editingSessionId,
		editingTitle,
		startEditingSession,
		setEditingTitle,
		clearEditingSession,
	} = useUiStore();

	return (
		<div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="text-sm font-semibold">{t("session.title")}</div>
					<div className="flex items-center">
						<Select
							value={i18n.resolvedLanguage ?? "en"}
							onValueChange={(value) => i18n.changeLanguage(value)}
						>
							<SelectTrigger
								size="sm"
								className="h-7 w-20 justify-between px-2 text-xs"
								aria-label={t("languageSwitcher.label")}
								title={t("languageSwitcher.chooseLanguage")}
							>
								<SelectValue placeholder={t("languageSwitcher.placeholder")} />
							</SelectTrigger>
							<SelectContent>
								{supportedLanguages.map((lang) => (
									<SelectItem key={lang} value={lang}>
										{t(`common.languages.${lang}`)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<div className="flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="outline"
								size="icon-sm"
								aria-label={t("theme.toggle")}
							>
								<HugeiconsIcon icon={PaintBoardIcon} strokeWidth={2} />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-40">
							<DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
							<DropdownMenuRadioGroup
								value={theme}
								onValueChange={(value) => setTheme(toThemePreference(value))}
							>
								<DropdownMenuRadioItem value="light">
									<HugeiconsIcon icon={SunIcon} strokeWidth={2} />
									{t("theme.light")}
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="dark">
									<HugeiconsIcon icon={MoonIcon} strokeWidth={2} />
									{t("theme.dark")}
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="system">
									<HugeiconsIcon icon={ComputerIcon} strokeWidth={2} />
									{t("theme.system")}
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>

					<Button onClick={onCreateSession} size="sm" disabled={isCreating}>
						{t("common.new")}
					</Button>
				</div>
			</div>
			<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
				{sessions.length === 0 ? (
					<div className="text-muted-foreground text-xs">
						{t("session.empty")}
					</div>
				) : null}
				{sessions.map((session) => (
					<SessionListItem
						key={session.sessionId}
						session={session}
						isActive={session.sessionId === activeSessionId}
						isEditing={session.sessionId === editingSessionId}
						editingTitle={editingTitle}
						onSelect={onSelectSession}
						onEdit={() => startEditingSession(session.sessionId, session.title)}
						onEditCancel={clearEditingSession}
						onEditSubmit={onEditSubmit}
						onEditingTitleChange={setEditingTitle}
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
	onEdit: () => void;
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
	const { t } = useTranslation();
	const statusVariant = getStatusVariant(session.state);
	const backendLabel = session.backendLabel ?? session.backendId;
	const statusLabel = t(`status.${session.state ?? "idle"}`, {
		defaultValue: session.state ?? "idle",
	});
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
						<Badge variant={statusVariant}>{statusLabel}</Badge>
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
							{t("common.save")}
						</Button>
						<Button size="xs" variant="outline" onClick={onEditCancel}>
							{t("common.cancel")}
						</Button>
					</>
				) : (
					<Button size="xs" variant="ghost" onClick={onEdit}>
						{t("common.rename")}
					</Button>
				)}
				<AlertDialog>
					<AlertDialogTrigger asChild>
						<Button size="xs" variant="destructive">
							{t("common.close")}
						</Button>
					</AlertDialogTrigger>
					<AlertDialogContent size="sm">
						<AlertDialogHeader>
							<AlertDialogTitle>{t("session.closeTitle")}</AlertDialogTitle>
							<AlertDialogDescription>
								{t("session.closeDescription")}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
							<AlertDialogAction
								variant="destructive"
								onClick={() => onClose(session.sessionId)}
							>
								{t("session.closeConfirm")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>
		</div>
	);
};
