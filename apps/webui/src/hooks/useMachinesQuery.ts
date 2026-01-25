import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { fetchMachines, type MachinesResponse } from "@/lib/api";
import { useMachinesStore } from "@/lib/machines-store";

export function useMachinesQuery() {
	const syncMachines = useMachinesStore((state) => state.syncMachines);

	const query = useQuery<MachinesResponse>({
		queryKey: ["machines"],
		queryFn: fetchMachines,
		staleTime: 30000,
	});

	useEffect(() => {
		if (query.data?.machines) {
			syncMachines(
				query.data.machines.map((machine) => ({
					machineId: machine.id,
					hostname: machine.hostname ?? undefined,
					connected: machine.isOnline,
					sessionCount: undefined,
				})),
			);
		} else {
			syncMachines([]);
		}
	}, [query.data, syncMachines]);

	return query;
}
