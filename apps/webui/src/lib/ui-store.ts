import { create } from "zustand";

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
}));
