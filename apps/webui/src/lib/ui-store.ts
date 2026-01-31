import { create } from "zustand";
import {
	MACHINE_SIDEBAR_WIDTH_KEY,
	SESSION_SIDEBAR_WIDTH_KEY,
} from "@/lib/ui-config";

const clamp = (value: number, min: number, max: number) =>
	Math.min(Math.max(value, min), max);

const loadStoredWidth = (key: string, fallback: number) => {
	if (typeof window === "undefined") {
		return fallback;
	}
	const raw = window.localStorage.getItem(key);
	if (!raw) {
		return fallback;
	}
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const persistWidth = (key: string, value: number) => {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(key, String(value));
};

const MACHINE_WIDTH_DEFAULT = 56;
const MACHINE_WIDTH_MIN = 48;
const MACHINE_WIDTH_MAX = 120;
const SESSION_WIDTH_DEFAULT = 256;
const SESSION_WIDTH_MIN = 200;
const SESSION_WIDTH_MAX = 520;

type UiState = {
	mobileMenuOpen: boolean;
	createDialogOpen: boolean;
	fileExplorerOpen: boolean;
	filePreviewPath?: string;
	editingSessionId: string | null;
	editingTitle: string;
	draftTitle: string;
	draftBackendId?: string;
	draftCwd?: string;
	selectedWorkspaceByMachine: Record<string, string>;
	expandedMachines: Record<string, boolean>;
	machineSidebarWidth: number;
	sessionSidebarWidth: number;
	setMobileMenuOpen: (open: boolean) => void;
	setCreateDialogOpen: (open: boolean) => void;
	setFileExplorerOpen: (open: boolean) => void;
	setFilePreviewPath: (path?: string) => void;
	startEditingSession: (sessionId: string, title: string) => void;
	setEditingTitle: (value: string) => void;
	clearEditingSession: () => void;
	setDraftTitle: (value: string) => void;
	setDraftBackendId: (value?: string) => void;
	setDraftCwd: (value?: string) => void;
	setSelectedWorkspace: (machineId: string, cwd?: string) => void;
	setMachineExpanded: (machineId: string, expanded: boolean) => void;
	toggleMachineExpanded: (machineId: string) => void;
	setMachineSidebarWidth: (width: number) => void;
	setSessionSidebarWidth: (width: number) => void;
};

export const useUiStore = create<UiState>((set) => ({
	mobileMenuOpen: false,
	createDialogOpen: false,
	fileExplorerOpen: false,
	filePreviewPath: undefined,
	editingSessionId: null,
	editingTitle: "",
	draftTitle: "",
	draftBackendId: undefined,
	draftCwd: undefined,
	selectedWorkspaceByMachine: {},
	expandedMachines: {},
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
	startEditingSession: (sessionId, title) =>
		set({ editingSessionId: sessionId, editingTitle: title }),
	setEditingTitle: (value) => set({ editingTitle: value }),
	clearEditingSession: () => set({ editingSessionId: null, editingTitle: "" }),
	setDraftTitle: (value) => set({ draftTitle: value }),
	setDraftBackendId: (value) => set({ draftBackendId: value }),
	setDraftCwd: (value) => set({ draftCwd: value }),
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
	setMachineExpanded: (machineId, expanded) =>
		set((state) => ({
			expandedMachines: { ...state.expandedMachines, [machineId]: expanded },
		})),
	toggleMachineExpanded: (machineId) =>
		set((state) => ({
			expandedMachines: {
				...state.expandedMachines,
				[machineId]: !state.expandedMachines[machineId],
			},
		})),
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
