import { useEffect, useRef } from "react";
import { getApiBaseUrl } from "@/lib/api";
import { useMachinesStore } from "@/lib/machines-store";

export function useMachinesStream() {
	const updateMachine = useMachinesStore((state) => state.updateMachine);
	const streamRef = useRef<EventSource | null>(null);

	useEffect(() => {
		if (streamRef.current) {
			return () => {
				streamRef.current?.close();
				streamRef.current = null;
			};
		}

		const url = new URL("/api/machines/stream", getApiBaseUrl());

		const stream = new EventSource(url.toString(), { withCredentials: true });
		streamRef.current = stream;

		stream.onmessage = (event) => {
			try {
				const payload = JSON.parse(event.data) as {
					machineId: string;
					isOnline: boolean;
					hostname?: string | null;
					sessionCount?: number | null;
				};
				updateMachine({
					machineId: payload.machineId,
					connected: payload.isOnline,
					hostname: payload.hostname ?? undefined,
					sessionCount: payload.sessionCount ?? undefined,
				});
			} catch (error) {
				console.error("[webui] Failed to parse machine stream event", error);
			}
		};

		stream.onerror = (error) => {
			console.error("[webui] Machine stream error", error);
		};

		return () => {
			stream.close();
			streamRef.current = null;
		};
	}, [updateMachine]);
}
