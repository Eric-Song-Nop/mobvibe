import { beforeEach, describe, expect, it } from "vitest";
import { getBackendCapability, useMachinesStore } from "../machines-store";

const resetStore = () => {
	useMachinesStore.setState({
		machines: {},
		selectedMachineId: null,
	});
};

describe("machines-store", () => {
	beforeEach(() => {
		resetStore();
	});

	it("updates backend capabilities for existing machine", () => {
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: true });

		useMachinesStore.getState().updateBackendCapabilities("machine-1", {
			"backend-a": { list: true, load: true },
		});

		const machine = useMachinesStore.getState().machines["machine-1"];
		expect(machine?.backendCapabilities).toEqual({
			"backend-a": { list: true, load: true },
		});
	});

	it("merges backend capabilities from multiple backends", () => {
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: true });

		useMachinesStore.getState().updateBackendCapabilities("machine-1", {
			"backend-a": { list: true, load: true },
		});
		useMachinesStore.getState().updateBackendCapabilities("machine-1", {
			"backend-b": { list: true, load: false },
		});

		const machine = useMachinesStore.getState().machines["machine-1"];
		expect(machine?.backendCapabilities).toEqual({
			"backend-a": { list: true, load: true },
			"backend-b": { list: true, load: false },
		});
	});

	it("preserves backend capabilities when updating machine status", () => {
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: true });
		useMachinesStore.getState().updateBackendCapabilities("machine-1", {
			"backend-a": { list: true, load: false },
		});

		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: false });

		const after = useMachinesStore.getState().machines["machine-1"];
		expect(after?.backendCapabilities).toEqual({
			"backend-a": { list: true, load: false },
		});
	});

	it("merges backendCapabilities from cli:status payload", () => {
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: true });
		useMachinesStore.getState().updateBackendCapabilities("machine-1", {
			"backend-a": { list: true, load: true },
		});

		// Simulate a cli:status with new backend capabilities
		useMachinesStore.getState().updateMachine({
			machineId: "machine-1",
			connected: true,
			backendCapabilities: {
				"backend-b": { list: false, load: false },
			},
		});

		const machine = useMachinesStore.getState().machines["machine-1"];
		expect(machine?.backendCapabilities).toEqual({
			"backend-a": { list: true, load: true },
			"backend-b": { list: false, load: false },
		});
	});

	it("preserves backend capabilities when syncing machines list", () => {
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: true });
		useMachinesStore.getState().updateBackendCapabilities("machine-1", {
			"backend-a": { list: true, load: true },
		});

		useMachinesStore.getState().syncMachines([
			{
				machineId: "machine-1",
				hostname: "host-1",
				connected: true,
			},
		]);

		const machine = useMachinesStore.getState().machines["machine-1"];
		expect(machine?.backendCapabilities).toEqual({
			"backend-a": { list: true, load: true },
		});
	});

	describe("getBackendCapability", () => {
		it("returns capability for specific backend", () => {
			const machine = {
				machineId: "m1",
				connected: true,
				backendCapabilities: {
					"backend-a": { list: true, load: true },
					"backend-b": { list: true, load: false },
				},
			};
			expect(getBackendCapability(machine, "backend-a", "load")).toBe(true);
			expect(getBackendCapability(machine, "backend-b", "load")).toBe(false);
		});

		it("returns undefined for unknown backend", () => {
			const machine = {
				machineId: "m1",
				connected: true,
				backendCapabilities: {
					"backend-a": { list: true, load: true },
				},
			};
			expect(getBackendCapability(machine, "unknown", "load")).toBeUndefined();
		});

		it("returns undefined when no capabilities", () => {
			const machine = { machineId: "m1", connected: true };
			expect(
				getBackendCapability(machine, "backend-a", "load"),
			).toBeUndefined();
		});
	});
});
