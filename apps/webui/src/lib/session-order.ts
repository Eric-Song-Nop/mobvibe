type TimestampedSessionLike = {
	sessionId: string;
	createdAt?: string;
	updatedAt?: string;
};

const INVALID_TIMESTAMP = Number.NEGATIVE_INFINITY;

const parseTimestamp = (value?: string): number => {
	if (!value) {
		return INVALID_TIMESTAMP;
	}

	const parsed = Date.parse(value);
	return Number.isNaN(parsed) ? INVALID_TIMESTAMP : parsed;
};

export const compareTimestampsByRecency = (
	left?: string,
	right?: string,
): number => {
	const leftTime = parseTimestamp(left);
	const rightTime = parseTimestamp(right);

	if (leftTime !== rightTime) {
		return rightTime - leftTime;
	}

	return (right ?? "").localeCompare(left ?? "");
};

const getSessionRecencyTimestamp = (session: TimestampedSessionLike): string =>
	session.updatedAt ?? session.createdAt ?? "";

export const compareSessionsByRecency = (
	left: TimestampedSessionLike,
	right: TimestampedSessionLike,
): number => {
	const byRecent = compareTimestampsByRecency(
		getSessionRecencyTimestamp(left),
		getSessionRecencyTimestamp(right),
	);
	if (byRecent !== 0) {
		return byRecent;
	}

	const byCreatedAt = compareTimestampsByRecency(
		left.createdAt,
		right.createdAt,
	);
	if (byCreatedAt !== 0) {
		return byCreatedAt;
	}

	return left.sessionId.localeCompare(right.sessionId);
};
