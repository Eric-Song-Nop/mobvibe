import {
	Add01Icon,
	ArchiveIcon,
	Cancel01Icon,
	CancelCircleIcon,
	Delete01Icon,
	File01Icon,
	FolderOpenIcon,
	GitCompareIcon,
	Logout01Icon,
	Moon02Icon,
	PaintBoardIcon,
	Search01Icon,
	Settings02Icon,
	Sun02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { GitStatusIndicator } from "@/components/app/git-status-indicator";
import { useAuth } from "@/components/auth/AuthProvider";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { AlertDialog, AlertDialogContent } from "@/components/ui/alert-dialog";
import { fetchSessionFsResources, fetchSessionGitStatus } from "@/lib/api";
import { useChatStore } from "@/lib/chat-store";
import { createFallbackError } from "@/lib/error-utils";
import { FuzzyHighlight, fuzzySearch } from "@/lib/fuzzy-search";
import { useUiStore } from "@/lib/ui-store";
import { cn } from "@/lib/utils";

export type CommandPaletteProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
};

type CommandGroup = "session" | "app" | "preferences";

type CommandItem = {
	id: string;
	name: string;
	shortcut?: string;
	icon: typeof Search01Icon;
	group: CommandGroup;
	enabled: boolean;
	action: () => void;
};

type FileSearchResult = {
	name: string;
	relativePath: string;
	path: string;
	gitStatus?: string;
};

function CommandPaletteContent({ open, onOpenChange }: CommandPaletteProps) {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const { theme, setTheme } = useTheme();
	const { user, signOut } = useAuth();
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Get state from stores
	const { sessions, activeSessionId } = useChatStore(
		useShallow((s) => ({
			sessions: s.sessions,
			activeSessionId: s.activeSessionId,
		})),
	);

	const activeSession = activeSessionId ? sessions[activeSessionId] : undefined;
	const isGenerating = activeSession?.sending ?? false;
	const hasMessages = (activeSession?.messages?.length ?? 0) > 0;

	const {
		setFileExplorerOpen,
		setChatSearchOpen,
		setCreateDialogOpen,
		setMobileMenuOpen,
	} = useUiStore(
		useShallow((s) => ({
			setFileExplorerOpen: s.setFileExplorerOpen,
			setChatSearchOpen: s.setChatSearchOpen,
			setCreateDialogOpen: s.setCreateDialogOpen,
			setMobileMenuOpen: s.setMobileMenuOpen,
		})),
	);

	const isFileMode = query.startsWith("@");
	const searchQuery = isFileMode ? query.slice(1) : query;

	// Built-in commands
	const builtinCommands = useMemo((): CommandItem[] => {
		const commands: CommandItem[] = [
			// Session group
			{
				id: "new-session",
				name: t("commandPalette.newSession"),
				shortcut: "Mod+N",
				icon: Add01Icon,
				group: "session",
				enabled: true,
				action: () => {
					onOpenChange(false);
					setCreateDialogOpen(true);
				},
			},
			{
				id: "archive-session",
				name: t("commandPalette.archiveSession"),
				icon: ArchiveIcon,
				group: "session",
				enabled: !!activeSessionId,
				action: () => {
					onOpenChange(false);
					// Archive is handled by SessionSidebar - user can use the sidebar to archive
					// This command navigates focus to the sidebar
					if (activeSessionId) {
						useChatStore.getState().setActiveSessionId(activeSessionId);
					}
				},
			},
			{
				id: "clear-chat",
				name: t("commandPalette.clearChat"),
				icon: Delete01Icon,
				group: "session",
				enabled: !!activeSessionId && hasMessages,
				action: () => {
					onOpenChange(false);
					if (activeSessionId) {
						useChatStore.getState().clearSessionMessages(activeSessionId);
					}
				},
			},
			{
				id: "cancel-generation",
				name: t("commandPalette.cancelGeneration"),
				icon: CancelCircleIcon,
				group: "session",
				enabled: isGenerating,
				action: () => {
					onOpenChange(false);
					// Cancel is handled by ChatFooter, we'll trigger it via store
					if (activeSessionId) {
						useChatStore.getState().setCanceling(activeSessionId, true);
					}
				},
			},
			// App group
			{
				id: "file-explorer",
				name: t("commandPalette.openFileExplorer"),
				shortcut: "Mod+B",
				icon: FolderOpenIcon,
				group: "app",
				enabled: !!activeSessionId,
				action: () => {
					onOpenChange(false);
					setFileExplorerOpen(true);
				},
			},
			{
				id: "chat-search",
				name: t("commandPalette.searchInChat"),
				shortcut: "Mod+F",
				icon: Search01Icon,
				group: "app",
				enabled: !!activeSessionId,
				action: () => {
					onOpenChange(false);
					setChatSearchOpen(true);
				},
			},
			{
				id: "file-search",
				name: t("commandPalette.searchFiles"),
				shortcut: "Mod+P",
				icon: File01Icon,
				group: "app",
				enabled: !!activeSessionId,
				action: () => setQuery("@"),
			},
			{
				id: "open-changes",
				name: t("commandPalette.openChanges"),
				icon: GitCompareIcon,
				group: "app",
				enabled: !!activeSessionId,
				action: () => {
					onOpenChange(false);
					setFileExplorerOpen(true);
				},
			},
			{
				id: "toggle-sidebar",
				name: t("commandPalette.toggleSidebar"),
				icon: FolderOpenIcon,
				group: "app",
				enabled: true,
				action: () => {
					onOpenChange(false);
					setMobileMenuOpen(true);
				},
			},
			{
				id: "open-settings",
				name: t("commandPalette.openSettings"),
				icon: Settings02Icon,
				group: "app",
				enabled: true,
				action: () => {
					onOpenChange(false);
					navigate("/settings");
				},
			},
			{
				id: "sign-out",
				name: t("commandPalette.signOut"),
				icon: Logout01Icon,
				group: "app",
				enabled: !!user,
				action: () => {
					onOpenChange(false);
					signOut();
				},
			},
			// Preferences group
			{
				id: "toggle-theme",
				name: t("commandPalette.toggleTheme"),
				icon: theme === "dark" ? Sun02Icon : Moon02Icon,
				group: "preferences",
				enabled: true,
				action: () => {
					onOpenChange(false);
					const nextTheme = theme === "dark" ? "light" : "dark";
					setTheme(nextTheme);
				},
			},
			{
				id: "switch-language",
				name: t("commandPalette.switchLanguage"),
				icon: PaintBoardIcon,
				group: "preferences",
				enabled: true,
				action: () => {
					onOpenChange(false);
					const nextLang = i18n.language === "zh" ? "en" : "zh";
					i18n.changeLanguage(nextLang);
				},
			},
		];
		return commands;
	}, [
		t,
		i18n,
		onOpenChange,
		setFileExplorerOpen,
		setChatSearchOpen,
		setCreateDialogOpen,
		setMobileMenuOpen,
		activeSessionId,
		hasMessages,
		isGenerating,
		navigate,
		theme,
		setTheme,
		user,
		signOut,
	]);

	// Filter commands by query
	const filteredCommands = useMemo(() => {
		if (isFileMode) return [];
		if (!searchQuery) return builtinCommands;
		const results = fuzzySearch({
			items: builtinCommands,
			getText: (cmd) => cmd.name,
			query: searchQuery,
		});
		return results;
	}, [builtinCommands, isFileMode, searchQuery]);

	// File search data
	const resourcesQuery = useQuery({
		queryKey: ["session-fs-resources", activeSessionId],
		queryFn: () => {
			if (!activeSessionId) {
				throw createFallbackError("No session", "request");
			}
			return fetchSessionFsResources({ sessionId: activeSessionId });
		},
		enabled: open && isFileMode && !!activeSessionId,
		staleTime: 60000,
	});

	const gitStatusQuery = useQuery({
		queryKey: ["session-git-status", activeSessionId],
		queryFn: () => {
			if (!activeSessionId) {
				throw createFallbackError("No session", "request");
			}
			return fetchSessionGitStatus({ sessionId: activeSessionId });
		},
		enabled: open && isFileMode && !!activeSessionId,
		staleTime: 30000,
	});

	// Build file search results with git status
	const fileResults = useMemo(() => {
		if (!isFileMode || !resourcesQuery.data) return [];

		// Pre-build a lookup map for O(1) git status access
		const gitStatusMap = new Map<string, string>();
		if (gitStatusQuery.data?.files) {
			for (const f of gitStatusQuery.data.files) {
				gitStatusMap.set(f.path, f.status);
			}
		}

		const resources: FileSearchResult[] = resourcesQuery.data.entries.map(
			(entry) => ({
				name: entry.name,
				relativePath: entry.relativePath,
				path: entry.path,
				gitStatus: gitStatusMap.get(entry.relativePath),
			}),
		);

		if (!searchQuery) {
			// Show git-changed files first when no query
			const changed = resources.filter((r) => r.gitStatus);
			const unchanged = resources.filter((r) => !r.gitStatus);
			return [...changed, ...unchanged].slice(0, 100).map((item) => ({
				item,
				score: 0,
				highlightRanges: [] as [number, number][],
			}));
		}

		return fuzzySearch({
			items: resources,
			getText: (r) => r.relativePath,
			query: searchQuery,
		}).slice(0, 100);
	}, [isFileMode, resourcesQuery.data, gitStatusQuery.data, searchQuery]);

	// Total items for keyboard navigation
	const totalItems = isFileMode ? fileResults.length : filteredCommands.length;

	// Virtualizer for results list
	const virtualizer = useVirtualizer({
		count: totalItems,
		getScrollElement: () => listRef.current,
		estimateSize: () => 48,
		overscan: 5,
	});

	// Reset selection when results change
	// biome-ignore lint/correctness/useExhaustiveDependencies: totalItems triggers reset on results change
	useEffect(() => {
		setSelectedIndex(0);
	}, [totalItems]);

	// Auto-focus input on open
	useEffect(() => {
		if (open) {
			setQuery("");
			setSelectedIndex(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open]);

	// Execute selected item
	const executeItem = useCallback(
		(index: number) => {
			if (isFileMode) {
				const result = fileResults[index];
				if (result) {
					onOpenChange(false);
					setFileExplorerOpen(true);
					useUiStore.getState().setFilePreviewPath(result.item.path);
				}
			} else {
				const result = filteredCommands[index];
				if (result) {
					const cmd = "item" in result ? result.item : result;
					(cmd as CommandItem).action();
				}
			}
		},
		[
			isFileMode,
			fileResults,
			filteredCommands,
			onOpenChange,
			setFileExplorerOpen,
		],
	);

	// Keyboard navigation
	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			switch (e.key) {
				case "ArrowDown":
					e.preventDefault();
					setSelectedIndex((prev) => (prev < totalItems - 1 ? prev + 1 : 0));
					break;
				case "ArrowUp":
					e.preventDefault();
					setSelectedIndex((prev) => (prev > 0 ? prev - 1 : totalItems - 1));
					break;
				case "Enter":
					e.preventDefault();
					executeItem(selectedIndex);
					break;
				case "Escape":
					e.preventDefault();
					if (isFileMode && query.length > 1) {
						setQuery("@");
					} else {
						onOpenChange(false);
					}
					break;
				case "Backspace":
					if (query === "@") {
						e.preventDefault();
						setQuery("");
					}
					break;
			}
		},
		[totalItems, selectedIndex, executeItem, isFileMode, query, onOpenChange],
	);

	// Scroll selected item into view
	useEffect(() => {
		if (totalItems > 0) {
			virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
		}
	}, [selectedIndex, totalItems, virtualizer]);

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent className="flex h-[100svh] w-[100vw] !max-w-none flex-col overflow-hidden translate-x-0 translate-y-0 rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] sm:pt-0 sm:pb-0 top-0 left-0 sm:h-auto sm:max-h-[28rem] sm:!w-[36rem] sm:!max-w-[36rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-lg sm:top-1/2 sm:left-1/2">
				{/* Search input */}
				<div className="border-b px-4 py-3">
					<div className="flex items-center gap-2">
						<HugeiconsIcon
							icon={Search01Icon}
							strokeWidth={2}
							className="text-muted-foreground h-4 w-4 shrink-0"
							aria-hidden="true"
						/>
						<input
							ref={inputRef}
							type="text"
							role="combobox"
							aria-expanded="true"
							aria-controls="command-palette-list"
							aria-activedescendant={
								selectedIndex >= 0
									? `command-palette-item-${selectedIndex}`
									: undefined
							}
							aria-label={t("commandPalette.searchPlaceholder")}
							className="bg-transparent flex-1 text-sm outline-none placeholder:text-muted-foreground"
							placeholder={t("commandPalette.searchPlaceholder")}
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							onKeyDown={handleKeyDown}
						/>
						{query ? (
							<button
								type="button"
								className="text-muted-foreground hover:text-foreground"
								onClick={() => setQuery("")}
							>
								<HugeiconsIcon
									icon={Cancel01Icon}
									strokeWidth={2}
									className="h-4 w-4"
									aria-hidden="true"
								/>
							</button>
						) : null}
					</div>
					{isFileMode ? (
						<div className="text-muted-foreground mt-1 text-xs">
							{t("commandPalette.searchFiles")}
						</div>
					) : null}
				</div>

				{/* Results list */}
				<div
					ref={listRef}
					id="command-palette-list"
					role="listbox"
					className="flex-1 overflow-y-auto"
				>
					{totalItems === 0 ? (
						<div className="text-muted-foreground flex items-center justify-center px-4 py-8 text-sm">
							{t("commandPalette.noResults")}
						</div>
					) : (
						<div
							style={{
								height: `${virtualizer.getTotalSize()}px`,
								position: "relative",
							}}
						>
							{virtualizer.getVirtualItems().map((virtualItem) => {
								const index = virtualItem.index;
								const isSelected = index === selectedIndex;

								if (isFileMode) {
									const result = fileResults[index];
									if (!result) return null;
									const { item, highlightRanges } = result;
									return (
										<button
											key={item.relativePath}
											id={`command-palette-item-${index}`}
											type="button"
											role="option"
											aria-selected={isSelected}
											ref={virtualizer.measureElement}
											data-index={index}
											className={cn(
												"absolute top-0 left-0 flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm",
												isSelected
													? "bg-accent text-accent-foreground"
													: "hover:bg-muted",
											)}
											style={{
												transform: `translateY(${virtualItem.start}px)`,
											}}
											onClick={() => executeItem(index)}
											onMouseEnter={() => setSelectedIndex(index)}
										>
											<HugeiconsIcon
												icon={File01Icon}
												strokeWidth={2}
												className="text-muted-foreground h-4 w-4 shrink-0"
												aria-hidden="true"
											/>
											<div className="min-w-0 flex-1">
												<FuzzyHighlight
													text={item.relativePath}
													ranges={highlightRanges}
													className="truncate block text-sm"
												/>
											</div>
											{item.gitStatus ? (
												<GitStatusIndicator
													status={
														item.gitStatus as import("@/lib/api").GitFileStatus
													}
												/>
											) : null}
										</button>
									);
								}

								const result = filteredCommands[index];
								if (!result) return null;
								const cmd = "item" in result ? result.item : result;
								const ranges =
									"highlightRanges" in result ? result.highlightRanges : [];
								const command = cmd as CommandItem;

								return (
									<button
										key={command.id}
										id={`command-palette-item-${index}`}
										type="button"
										role="option"
										aria-selected={isSelected}
										ref={virtualizer.measureElement}
										data-index={index}
										className={cn(
											"absolute top-0 left-0 flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left text-sm",
											isSelected
												? "bg-accent text-accent-foreground"
												: "hover:bg-muted",
											!command.enabled && "opacity-50 cursor-not-allowed",
										)}
										style={{
											transform: `translateY(${virtualItem.start}px)`,
										}}
										onClick={() => command.enabled && executeItem(index)}
										onMouseEnter={() => setSelectedIndex(index)}
										disabled={!command.enabled}
									>
										<HugeiconsIcon
											icon={command.icon}
											strokeWidth={2}
											className="text-muted-foreground h-4 w-4 shrink-0"
											aria-hidden="true"
										/>
										<div className="min-w-0 flex-1">
											<FuzzyHighlight
												text={command.name}
												ranges={ranges}
												className="text-sm"
											/>
										</div>
										{command.shortcut ? (
											<span className="text-muted-foreground shrink-0 text-xs">
												{command.shortcut}
											</span>
										) : null}
									</button>
								);
							})}
						</div>
					)}
				</div>
			</AlertDialogContent>
		</AlertDialog>
	);
}

// Wrap with ThemeProvider to ensure useTheme works
export function CommandPalette(props: CommandPaletteProps) {
	return (
		<ThemeProvider>
			<CommandPaletteContent {...props} />
		</ThemeProvider>
	);
}
