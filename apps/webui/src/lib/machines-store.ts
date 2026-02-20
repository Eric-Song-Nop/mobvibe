import { create } from "zustand";
import type { AgentSessionCapabilities, CliStatusPayload } from "./acp";

export type Machine = {
	machineId: string;
	hostname?: string;
	connected: boolean;
	sessionCount?: number;
	userId?: string;
	/** Per-backend capabilities */
	backendCapabilities?: Record<string, AgentSessionCapabilities>;
};

type MachinesState = {
	machines: Record<string, Machine>;
	selectedMachineId: string | null;
	setSelectedMachineId: (machineId: string | null) => void;
	updateMachine: (payload: CliStatusPayload) => void;
	removeMachine: (machineId: string) => void;
	syncMachines: (machines: Machine[]) => void;
	updateBackendCapabilities: (
		machineId: string,
		backendCapabilities: Record<string, AgentSessionCapabilities>,
	) => void;
};

export const useMachinesStore = create<MachinesState>((set) => ({
	machines: {},
	selectedMachineId: null,

	setSelectedMachineId: (machineId) => set({ selectedMachineId: machineId }),

	updateMachine: (payload) =>
		set((state) => {
			const existing = state.machines[payload.machineId];
			const machine: Machine = {
				machineId: payload.machineId,
				hostname: payload.hostname ?? existing?.hostname,
				connected: payload.connected,
				sessionCount: payload.sessionCount,
				userId: payload.userId,
				backendCapabilities: payload.backendCapabilities
					? { ...existing?.backendCapabilities, ...payload.backendCapabilities }
					: existing?.backendCapabilities,
			};

			// Auto-select first connected machine if none selected
			let { selectedMachineId } = state;
			if (!selectedMachineId && payload.connected) {
				selectedMachineId = payload.machineId;
			}

			// Clear selection if selected machine disconnected
			if (selectedMachineId === payload.machineId && !payload.connected) {
				// Find another connected machine
				const connectedMachines = Object.values(state.machines).filter(
					(m) => m.machineId !== payload.machineId && m.connected,
				);
				selectedMachineId = connectedMachines[0]?.machineId ?? null;
			}

			return {
				machines: {
					...state.machines,
					[payload.machineId]: machine,
				},
				selectedMachineId,
			};
		}),

	removeMachine: (machineId) =>
		set((state) => {
			const { [machineId]: _, ...rest } = state.machines;
			const nextSelected =
				state.selectedMachineId === machineId ? null : state.selectedMachineId;
			return { machines: rest, selectedMachineId: nextSelected };
		}),

	updateBackendCapabilities: (machineId, backendCapabilities) =>
		set((state) => {
			const existing = state.machines[machineId];
			if (!existing) {
				return state;
			}
			return {
				machines: {
					...state.machines,
					[machineId]: {
						...existing,
						backendCapabilities: {
							...existing.backendCapabilities,
							...backendCapabilities,
						},
					},
				},
			};
		}),

	syncMachines: (machines) =>
		set((state) => {
			const nextMachines: Record<string, Machine> = {};
			for (const machine of machines) {
				const existing = state.machines[machine.machineId];
				nextMachines[machine.machineId] = {
					...machine,
					backendCapabilities: existing?.backendCapabilities,
				};
			}

			// Keep selection if still valid
			let { selectedMachineId } = state;
			if (selectedMachineId && !nextMachines[selectedMachineId]?.connected) {
				const connectedMachine = machines.find((m) => m.connected);
				selectedMachineId = connectedMachine?.machineId ?? null;
			}

			return { machines: nextMachines, selectedMachineId };
		}),
}));

/** Check capability for a specific backend. Returns undefined if unknown. */
export const getBackendCapability = (
	machine: Machine | undefined,
	backendId: string | undefined,
	capability: keyof AgentSessionCapabilities,
): boolean | undefined => {
	if (!machine?.backendCapabilities || !backendId) return undefined;
	return machine.backendCapabilities[backendId]?.[capability];
};
