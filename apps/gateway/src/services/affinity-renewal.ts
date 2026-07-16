import type { Socket } from "socket.io";
import { logger } from "../lib/logger.js";
import type { CliRegistry } from "./cli-registry.js";
import type { UserAffinityManager } from "./user-affinity.js";

type UserSocket = Socket & { data: { userId?: string } };

export async function renewActiveUserAffinities(
	userAffinity: Pick<UserAffinityManager, "renewAll">,
	cliRegistry: Pick<CliRegistry, "getConnectedUserIds" | "getClisForUser">,
	webuiSocketIterable: Iterable<Socket>,
): Promise<string[]> {
	const webuiSockets = Array.from(webuiSocketIterable) as UserSocket[];
	const activeUserIds = new Set(cliRegistry.getConnectedUserIds());
	for (const socket of webuiSockets) {
		if (socket.data.userId) activeUserIds.add(socket.data.userId);
	}

	const conflicts = await userAffinity.renewAll(Array.from(activeUserIds));
	for (const userId of conflicts) {
		const cliSockets = cliRegistry
			.getClisForUser(userId)
			.map((record) => record.socket);
		const conflictingWebuiSockets = webuiSockets.filter(
			(socket) => socket.data.userId === userId,
		);
		logger.warn(
			{
				userId,
				cliCount: cliSockets.length,
				webuiCount: conflictingWebuiSockets.length,
			},
			"affinity_conflict_connections_disconnected",
		);
		for (const socket of cliSockets) socket.disconnect(true);
		for (const socket of conflictingWebuiSockets) socket.disconnect(true);
	}
	return conflicts;
}
