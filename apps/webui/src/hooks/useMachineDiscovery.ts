import { useEffect, useRef } from "react";
import type { AgentSessionCapabilities } from "@/lib/acp";
import type { Machine } from "@/lib/machines-store";

export type UseMachineDiscoveryParams = {
	machines: Record<string, Machine>;
	selectedWorkspaceByMachine: Record<string, string>;
	discoverMachines: (
		variables: { machineId: string; cwd: string },
		options: {
			onSuccess: (result: { capabilities: AgentSessionCapabilities }) => void;
			onSettled: () => void;
		},
	) => void;
	setMachineCapabilities: (
		machineId: string,
		caps: AgentSessionCapabilities,
	) => void;
};

export function useMachineDiscovery({
	machines,
	selectedWorkspaceByMachine,
	discoverMachines,
	setMachineCapabilities,
}: UseMachineDiscoveryParams): void {
	const discoveryInFlightRef = useRef(new Set<string>());
	const previousConnectionRef = useRef<Record<string, boolean>>({});
	const discoverRef = useRef(discoverMachines);
	discoverRef.current = discoverMachines;

	useEffect(() => {
		const previous = previousConnectionRef.current;

		for (const machine of Object.values(machines)) {
			const wasConnected = previous[machine.machineId];
			previous[machine.machineId] = machine.connected;

			if (!machine.connected) {
				continue;
			}
			if (machine.lastCapabilitiesAt && wasConnected) {
				continue;
			}
			if (discoveryInFlightRef.current.has(machine.machineId)) {
				continue;
			}
			const workspaceCwd = selectedWorkspaceByMachine[machine.machineId];
			if (!workspaceCwd) {
				continue;
			}

			discoveryInFlightRef.current.add(machine.machineId);
			discoverRef.current(
				{ machineId: machine.machineId, cwd: workspaceCwd },
				{
					onSuccess: (result) => {
						setMachineCapabilities(machine.machineId, result.capabilities);
					},
					onSettled: () => {
						discoveryInFlightRef.current.delete(machine.machineId);
					},
				},
			);
		}
	}, [machines, selectedWorkspaceByMachine, setMachineCapabilities]);
}
