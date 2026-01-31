import { beforeEach, describe, expect, it } from "vitest";
import { useMachinesStore } from "../machines-store";

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

	it("sets machine capabilities for existing machine", () => {
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: true });

		useMachinesStore.getState().setMachineCapabilities("machine-1", {
			list: true,
			load: true,
		});

		const machine = useMachinesStore.getState().machines["machine-1"];
		expect(machine?.capabilities).toEqual({ list: true, load: true });
		expect(machine?.lastCapabilitiesAt).toBeDefined();
	});

	it("preserves capabilities when updating machine status", () => {
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: true });
		useMachinesStore.getState().setMachineCapabilities("machine-1", {
			list: true,
			load: false,
		});

		const before = useMachinesStore.getState().machines["machine-1"];
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: false });

		const after = useMachinesStore.getState().machines["machine-1"];
		expect(after?.capabilities).toEqual({ list: true, load: false });
		expect(after?.lastCapabilitiesAt).toBe(before?.lastCapabilitiesAt);
	});

	it("preserves capabilities when syncing machines list", () => {
		useMachinesStore
			.getState()
			.updateMachine({ machineId: "machine-1", connected: true });
		useMachinesStore.getState().setMachineCapabilities("machine-1", {
			list: true,
			load: true,
		});

		useMachinesStore.getState().syncMachines([
			{
				machineId: "machine-1",
				hostname: "host-1",
				connected: true,
			},
		]);

		const machine = useMachinesStore.getState().machines["machine-1"];
		expect(machine?.capabilities).toEqual({ list: true, load: true });
		expect(machine?.lastCapabilitiesAt).toBeDefined();
	});
});
