import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFlyReplayMiddleware } from "../fly-replay.js";

const { mockGetSession } = vi.hoisted(() => ({ mockGetSession: vi.fn() }));

vi.mock("../../lib/auth.js", () => ({
	auth: { api: { getSession: mockGetSession } },
}));

vi.mock("../../lib/logger.js", () => ({
	logger: { info: vi.fn(), warn: vi.fn() },
}));

describe("fly replay middleware", () => {
	beforeEach(() => {
		mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
	});

	it("uses affinity initialized after middleware installation", async () => {
		let affinity: { getUserInstance: ReturnType<typeof vi.fn> } | null = null;
		const middleware = createFlyReplayMiddleware(
			(() => affinity) as never,
			"instance-local",
		);
		affinity = {
			getUserInstance: vi.fn(async () => ({
				instanceId: "instance-owner",
				region: "ord",
			})),
		};
		const request = {
			headers: { authorization: "Bearer token" },
			path: "/message",
		} as unknown as Request;
		const response = {
			set: vi.fn(),
			status: vi.fn(),
			json: vi.fn(),
		} as unknown as Response;
		vi.mocked(response.status).mockReturnValue(response);
		const next = vi.fn() as unknown as NextFunction;

		await middleware(request, response, next);

		expect(affinity.getUserInstance).toHaveBeenCalledWith("user-1");
		expect(response.set).toHaveBeenCalledWith(
			"fly-replay",
			"instance=instance-owner",
		);
		expect(response.status).toHaveBeenCalledWith(409);
		expect(next).not.toHaveBeenCalled();
	});
});
