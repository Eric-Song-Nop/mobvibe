import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createFlyReplayMiddleware,
	INSTANCE_ROUTING_ALLOWED_HEADERS,
	INSTANCE_ROUTING_EXPOSED_HEADERS,
} from "../fly-replay.js";

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

	it("exports the CORS contract needed by browser routing headers", () => {
		expect(INSTANCE_ROUTING_ALLOWED_HEADERS).toContain("fly-force-instance-id");
		expect(INSTANCE_ROUTING_EXPOSED_HEADERS).toContain("x-mobvibe-instance-id");
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

	it("advertises the authoritative local owner for direct large requests", async () => {
		const affinity = {
			getUserInstance: vi.fn(async () => ({
				instanceId: "instance-local",
				region: "sjc",
			})),
		};
		const middleware = createFlyReplayMiddleware(
			(() => affinity) as never,
			"instance-local",
		);
		const request = {
			headers: {
				authorization: "Bearer token",
				"content-length": String(2 * 1024 * 1024),
				"fly-force-instance-id": "instance-local",
			},
			path: "/message",
		} as unknown as Request;
		const response = { set: vi.fn() } as unknown as Response;
		const next = vi.fn() as unknown as NextFunction;

		await middleware(request, response, next);

		expect(response.set).toHaveBeenCalledWith(
			"x-mobvibe-instance-id",
			"instance-local",
		);
		expect(next).toHaveBeenCalledOnce();
		expect(response.set).not.toHaveBeenCalledWith(
			"fly-replay",
			expect.anything(),
		);
	});

	it("advertises the current instance when authenticated affinity is unclaimed", async () => {
		const affinity = {
			getUserInstance: vi.fn(async () => null),
		};
		const middleware = createFlyReplayMiddleware(
			(() => affinity) as never,
			"instance-local",
		);
		const request = {
			headers: { authorization: "Bearer token" },
			path: "/routing",
		} as unknown as Request;
		const response = { set: vi.fn() } as unknown as Response;
		const next = vi.fn() as unknown as NextFunction;

		await middleware(request, response, next);

		expect(response.set).toHaveBeenCalledWith(
			"x-mobvibe-instance-id",
			"instance-local",
		);
		expect(next).toHaveBeenCalledOnce();
	});

	it("does not advertise an owner when affinity is unavailable", async () => {
		const middleware = createFlyReplayMiddleware(() => null, "instance-local");
		const request = {
			headers: { authorization: "Bearer token" },
			path: "/routing",
		} as unknown as Request;
		const response = { set: vi.fn() } as unknown as Response;
		const next = vi.fn() as unknown as NextFunction;

		await middleware(request, response, next);

		expect(response.set).not.toHaveBeenCalled();
		expect(next).toHaveBeenCalledOnce();
	});

	it("returns the new owner instead of replaying a forced large request", async () => {
		const affinity = {
			getUserInstance: vi.fn(async () => ({
				instanceId: "instance-new-owner",
				region: "ord",
			})),
		};
		const middleware = createFlyReplayMiddleware(
			(() => affinity) as never,
			"instance-old-owner",
		);
		const request = {
			headers: {
				authorization: "Bearer token",
				"fly-force-instance-id": "instance-old-owner",
			},
			path: "/message",
			get: (name: string) =>
				name.toLowerCase() === "fly-force-instance-id"
					? "instance-old-owner"
					: undefined,
		} as unknown as Request;
		const response = {
			set: vi.fn(),
			status: vi.fn(),
			json: vi.fn(),
		} as unknown as Response;
		vi.mocked(response.status).mockReturnValue(response);
		const next = vi.fn() as unknown as NextFunction;

		await middleware(request, response, next);

		expect(response.set).toHaveBeenCalledWith(
			"x-mobvibe-instance-id",
			"instance-new-owner",
		);
		expect(response.set).not.toHaveBeenCalledWith(
			"fly-replay",
			expect.anything(),
		);
		expect(response.status).toHaveBeenCalledWith(409);
		expect(response.json).toHaveBeenCalledWith({
			error: {
				code: "INSTANCE_AFFINITY_CHANGED",
				message: "Request must be retried on the current session owner",
				retryable: true,
				scope: "request",
			},
		});
		expect(next).not.toHaveBeenCalled();
	});
});
