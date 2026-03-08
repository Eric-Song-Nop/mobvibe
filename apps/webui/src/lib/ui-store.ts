import { create } from "zustand";
import type { ContentBlock } from "@/lib/acp";
import { createDefaultContentBlocks } from "@/lib/content-block-utils";
import {
	MACHINE_SIDEBAR_WIDTH_KEY,
	SESSION_SIDEBAR_WIDTH_KEY,
} from "@/lib/ui-config";

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

const getBrowserStorage = (): Storage | undefined => {
	if (typeof window === "undefined") {
		return undefined;
	}
	const storage = window.localStorage;
	if (
		!storage ||
		typeof storage.getItem !== "function" ||
		typeof storage.setItem !== "function"
	) {
		return undefined;
	}
	return storage;
};

const loadStoredWidth = (key: string, fallback: number) => {
	const storage = getBrowserStorage();
	if (!storage) {
		return fallback;
	}
	const raw = storage.getItem(key);
	if (!raw) {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const persistWidth = (key: string, value: number) => {
	const storage = getBrowserStorage();
	if (!storage) {
		return;
	}
	storage.setItem(key, String(value));
};

const MACHINE_WIDTH_DEFAULT = 56;
const MACHINE_WIDTH_MIN = 48;
const MACHINE_WIDTH_MAX = 120;
const SESSION_WIDTH_DEFAULT = 256;
const SESSION_WIDTH_MIN = 200;
const SESSION_WIDTH_MAX = 520;

export type ChatDraft = {
	input: string;
	inputContents: ContentBlock[];
};

export const createEmptyChatDraft = (): ChatDraft => ({
	input: "",
	inputContents: createDefaultContentBlocks(""),
});

type UiState = {
	mobileMenuOpen: boolean;
	createDialogOpen: boolean;
	fileExplorerOpen: boolean;
	filePreviewPath?: string;
	commandPaletteOpen: boolean;
	chatSearchOpen: boolean;
	editingSessionId: string | null;
	editingTitle: string;
	draftTitle: string;
	draftBackendId?: string;
	draftCwd?: string;
	draftWorktreeEnabled: boolean;
	draftWorktreeBranch: string;
	draftWorktreeBaseBranch?: string;
	chatDrafts: Record<string, ChatDraft>;
	selectedWorkspaceByMachine: Record<string, string>;
	sidebarTab: "workspaces" | "sessions";
	machineSidebarWidth: number;
	sessionSidebarWidth: number;
	setMobileMenuOpen: (open: boolean) => void;
	setCreateDialogOpen: (open: boolean) => void;
	setFileExplorerOpen: (open: boolean) => void;
	setFilePreviewPath: (path?: string) => void;
	setCommandPaletteOpen: (open: boolean) => void;
	setChatSearchOpen: (open: boolean) => void;
	startEditingSession: (sessionId: string, title: string) => void;
	setEditingTitle: (value: string) => void;
	clearEditingSession: () => void;
	setDraftTitle: (value: string) => void;
	setDraftBackendId: (value?: string) => void;
	setDraftCwd: (value?: string) => void;
	setDraftWorktreeEnabled: (value: boolean) => void;
	setDraftWorktreeBranch: (value: string) => void;
	setDraftWorktreeBaseBranch: (value?: string) => void;
	resetDraftWorktree: () => void;
	setChatDraft: (sessionId: string, draft: ChatDraft) => void;
	clearChatDraft: (sessionId: string) => void;
	setSelectedWorkspace: (machineId: string, cwd?: string) => void;
	setSidebarTab: (tab: "workspaces" | "sessions") => void;
	setMachineSidebarWidth: (width: number) => void;
	setSessionSidebarWidth: (width: number) => void;
};

export const useUiStore = create<UiState>((set) => ({
	mobileMenuOpen: false,
	createDialogOpen: false,
	fileExplorerOpen: false,
	filePreviewPath: undefined,
	commandPaletteOpen: false,
	chatSearchOpen: false,
	editingSessionId: null,
	editingTitle: "",
	draftTitle: "",
	draftBackendId: undefined,
	draftCwd: undefined,
	draftWorktreeEnabled: false,
	draftWorktreeBranch: "",
	draftWorktreeBaseBranch: undefined,
	chatDrafts: {},
	selectedWorkspaceByMachine: {},
	sidebarTab: "sessions",
	machineSidebarWidth: loadStoredWidth(
		MACHINE_SIDEBAR_WIDTH_KEY,
		MACHINE_WIDTH_DEFAULT,
	),
	sessionSidebarWidth: loadStoredWidth(
		SESSION_SIDEBAR_WIDTH_KEY,
		SESSION_WIDTH_DEFAULT,
	),
	setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
	setCreateDialogOpen: (open) => set({ createDialogOpen: open }),
	setFileExplorerOpen: (open) =>
		set((state) => ({
			fileExplorerOpen: open,
			filePreviewPath: open ? state.filePreviewPath : undefined,
		})),
	setFilePreviewPath: (path) => set({ filePreviewPath: path }),
	setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
	setChatSearchOpen: (open) => set({ chatSearchOpen: open }),
	startEditingSession: (sessionId, title) =>
		set({ editingSessionId: sessionId, editingTitle: title }),
	setEditingTitle: (value) => set({ editingTitle: value }),
	clearEditingSession: () => set({ editingSessionId: null, editingTitle: "" }),
	setDraftTitle: (value) => set({ draftTitle: value }),
	setDraftBackendId: (value) => set({ draftBackendId: value }),
	setDraftCwd: (value) => set({ draftCwd: value }),
	setDraftWorktreeEnabled: (value) => set({ draftWorktreeEnabled: value }),
	setDraftWorktreeBranch: (value) => set({ draftWorktreeBranch: value }),
	setDraftWorktreeBaseBranch: (value) =>
		set({ draftWorktreeBaseBranch: value }),
	resetDraftWorktree: () =>
		set({
			draftWorktreeEnabled: false,
			draftWorktreeBranch: "",
			draftWorktreeBaseBranch: undefined,
		}),
	setChatDraft: (sessionId, draft) =>
		set((state) => ({
			chatDrafts: {
				...state.chatDrafts,
				[sessionId]: draft,
			},
		})),
	clearChatDraft: (sessionId) =>
		set((state) => {
			if (!(sessionId in state.chatDrafts)) {
				return state;
			}
			const chatDrafts = { ...state.chatDrafts };
			delete chatDrafts[sessionId];
			return { chatDrafts };
		}),
	setSelectedWorkspace: (machineId, cwd) =>
		set((state) => {
			const next = { ...state.selectedWorkspaceByMachine };
			if (cwd) {
				next[machineId] = cwd;
			} else {
				delete next[machineId];
			}
			return { selectedWorkspaceByMachine: next };
		}),
	setSidebarTab: (tab) => set({ sidebarTab: tab }),
	setMachineSidebarWidth: (width) =>
		set(() => {
			const next = clamp(width, MACHINE_WIDTH_MIN, MACHINE_WIDTH_MAX);
			persistWidth(MACHINE_SIDEBAR_WIDTH_KEY, next);
			return { machineSidebarWidth: next };
		}),
	setSessionSidebarWidth: (width) =>
		set(() => {
			const next = clamp(width, SESSION_WIDTH_MIN, SESSION_WIDTH_MAX);
			persistWidth(SESSION_SIDEBAR_WIDTH_KEY, next);
			return { sessionSidebarWidth: next };
		}),
}));
