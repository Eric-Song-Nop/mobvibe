import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	bulkArchiveAcpSessions,
	createAcpSessionDirect,
} from "../db-service.js";

type MockFn = ReturnType<typeof vi.fn>;

type DbMock = {
	insert: MockFn;
	select: MockFn;
	update: MockFn;
};

type LoggerMock = {
	error: MockFn;
	warn: MockFn;
	info: MockFn;
	debug: MockFn;
};

type SelectChain = {
	from: MockFn;
	where: MockFn;
	limit: MockFn;
};

type UpdateChain = {
	set: MockFn;
	where: MockFn;
};

const { dbMock, loggerMock } = vi.hoisted(() => ({
	dbMock: {
		insert: vi.fn(),
		select: vi.fn(),
		update: vi.fn(),
	} satisfies DbMock,
	loggerMock: {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
	} satisfies LoggerMock,
}));

vi.mock("../../db/index.js", () => ({
	db: dbMock,
}));

vi.mock("../../lib/logger.js", () => ({
	logger: loggerMock,
}));

const makeSelectChain = (result: unknown): SelectChain => {
	const chain: SelectChain = {
		from: vi.fn(),
		where: vi.fn(),
		limit: vi.fn(),
	};
	chain.from.mockReturnValue(chain);
	chain.where.mockReturnValue(chain);
	chain.limit.mockResolvedValue(result);
	return chain;
};

const makeUpdateChain = (): UpdateChain => {
	const chain: UpdateChain = {
		set: vi.fn(),
		where: vi.fn(),
	};
	chain.set.mockReturnValue(chain);
	chain.where.mockResolvedValue(undefined);
	return chain;
};

const makeUpdateChainWithReturning = (
	returningResult: unknown[],
): UpdateChain & { returning: MockFn } => {
	const chain = {
		set: vi.fn(),
		where: vi.fn(),
		returning: vi.fn(),
	};
	chain.set.mockReturnValue(chain);
	chain.where.mockReturnValue(chain);
	chain.returning.mockResolvedValue(returningResult);
	return chain;
};

describe("createAcpSessionDirect", () => {
	beforeEach(() => {
		dbMock.insert.mockReset();
		dbMock.select.mockReset();
		dbMock.update.mockReset();
		loggerMock.error.mockReset();
		loggerMock.warn.mockReset();
		loggerMock.info.mockReset();
		loggerMock.debug.mockReset();
	});

	it("updates existing session on unique constraint conflict", async () => {
		const values = vi.fn().mockRejectedValue({ code: "23505" });
		dbMock.insert.mockReturnValue({ values });

		const selectChain = makeSelectChain([
			{ id: "row-1", userId: "user-1", machineId: "machine-1" },
		]);
		dbMock.select.mockReturnValue(selectChain);

		const updateChain = makeUpdateChain();
		dbMock.update.mockReturnValue(updateChain);

		const result = await createAcpSessionDirect({
			userId: "user-1",
			machineId: "machine-1",
			sessionId: "session-1",
			title: "Session Title",
			backendId: "backend-1",
			cwd: "/tmp/project",
		});

		expect(result).toEqual({ _id: "row-1" });
		expect(updateChain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Session Title",
				backendId: "backend-1",
				state: "active",
				closedAt: null,
				cwd: "/tmp/project",
				updatedAt: expect.any(Date),
			}),
		);
	});

	it("returns null when existing session belongs to another owner", async () => {
		const values = vi.fn().mockRejectedValue({ code: "23505" });
		dbMock.insert.mockReturnValue({ values });

		const selectChain = makeSelectChain([
			{ id: "row-1", userId: "user-2", machineId: "machine-1" },
		]);
		dbMock.select.mockReturnValue(selectChain);

		const updateChain = makeUpdateChain();
		dbMock.update.mockReturnValue(updateChain);

		const result = await createAcpSessionDirect({
			userId: "user-1",
			machineId: "machine-1",
			sessionId: "session-1",
			title: "Session Title",
			backendId: "backend-1",
		});

		expect(result).toBeNull();
		expect(updateChain.set).not.toHaveBeenCalled();
	});
});

describe("bulkArchiveAcpSessions", () => {
	beforeEach(() => {
		dbMock.insert.mockReset();
		dbMock.select.mockReset();
		dbMock.update.mockReset();
		loggerMock.error.mockReset();
		loggerMock.warn.mockReset();
		loggerMock.info.mockReset();
		loggerMock.debug.mockReset();
	});

	it("returns 0 for empty sessionIds array without calling DB", async () => {
		const result = await bulkArchiveAcpSessions([], "user-1");

		expect(result).toBe(0);
		expect(dbMock.update).not.toHaveBeenCalled();
	});

	it("archives sessions and returns count from returning result", async () => {
		const chain = makeUpdateChainWithReturning([
			{ id: "row-1" },
			{ id: "row-2" },
		]);
		dbMock.update.mockReturnValue(chain);

		const result = await bulkArchiveAcpSessions(
			["session-1", "session-2"],
			"user-1",
		);

		expect(result).toBe(2);
		expect(chain.set).toHaveBeenCalledWith(
			expect.objectContaining({
				state: "archived",
				closedAt: expect.any(Date),
				updatedAt: expect.any(Date),
			}),
		);
	});

	it("returns 0 and logs error when DB throws", async () => {
		const chain = makeUpdateChainWithReturning([]);
		chain.returning.mockRejectedValue(new Error("connection lost"));
		dbMock.update.mockReturnValue(chain);

		const result = await bulkArchiveAcpSessions(["session-1"], "user-1");

		expect(result).toBe(0);
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ err: expect.any(Error) }),
			"db_bulk_archive_sessions_error",
		);
	});
});
