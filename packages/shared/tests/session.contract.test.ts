import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";

import type {
	GatewaySessionsChangedPayload,
	GatewayToWebuiEvents,
	SessionSummary,
	SessionsChangedPayload,
	SessionsResponse,
} from "../src/index.js";

describe("SessionSummary shared contract", () => {
	it("exposes only a literal Team ownership classification marker", () => {
		expectTypeOf<SessionSummary["agentTeamOwned"]>().toEqualTypeOf<
			true | undefined
		>();

		const source = readFileSync(
			resolve(import.meta.dirname, "../src/types/session.ts"),
			"utf8",
		);
		expect(source).toMatch(/agentTeamOwned\?: true/);
	});

	it("requires explicit machine coverage on session snapshots", () => {
		expectTypeOf<SessionsResponse["coveredMachineIds"]>().toEqualTypeOf<
			string[]
		>();

		const source = readFileSync(
			resolve(import.meta.dirname, "../src/types/socket-events.ts"),
			"utf8",
		);
		expect(source).toMatch(/coveredMachineIds: string\[\]/);
	});

	it("distinguishes optional CLI ingress from canonical Gateway session deltas", () => {
		expectTypeOf<SessionsChangedPayload["machineId"]>().toEqualTypeOf<
			string | undefined
		>();
		expectTypeOf<
			GatewaySessionsChangedPayload["machineId"]
		>().toEqualTypeOf<string>();
		expectTypeOf<
			Parameters<GatewayToWebuiEvents["sessions:changed"]>[0]
		>().toEqualTypeOf<GatewaySessionsChangedPayload>();
	});
});
