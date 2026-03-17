import { EventEmitter } from "node:events";
import type {
	GatewayToCliWirePayloadMap,
	GatewayToCliWireType,
} from "@mobvibe/shared";

export interface CliTransport {
	readonly id: string;
	close(code?: number, reason?: string): void;
	onDisconnect(listener: (reason?: string) => void): () => void;
	send<TType extends GatewayToCliWireType>(
		type: TType,
		payload: GatewayToCliWirePayloadMap[TType],
	): void;
}

export class CliTransportDisconnectEmitter {
	private readonly emitter = new EventEmitter();

	emit(reason?: string) {
		this.emitter.emit("disconnect", reason);
	}

	on(listener: (reason?: string) => void) {
		this.emitter.on("disconnect", listener);
		return () => {
			this.emitter.off("disconnect", listener);
		};
	}
}
