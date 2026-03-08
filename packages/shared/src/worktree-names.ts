const WORKTREE_ADJECTIVES = [
	"amber",
	"brisk",
	"calm",
	"clever",
	"cosmic",
	"curious",
	"dapper",
	"eager",
	"fancy",
	"gentle",
	"glossy",
	"jolly",
	"lively",
	"lucky",
	"mellow",
	"misty",
	"nimble",
	"odd",
	"peppy",
	"quiet",
	"rapid",
	"shiny",
	"snug",
	"spry",
	"sturdy",
	"sunny",
	"swift",
	"tidy",
	"vivid",
	"wavy",
	"whimsy",
	"zesty",
] as const;

const WORKTREE_NOUNS = [
	"anchor",
	"beacon",
	"bloom",
	"breeze",
	"comet",
	"drift",
	"ember",
	"falcon",
	"feather",
	"forest",
	"galaxy",
	"harbor",
	"island",
	"lantern",
	"meadow",
	"meteor",
	"nebula",
	"oasis",
	"orbit",
	"otter",
	"paddle",
	"pebble",
	"pine",
	"ripple",
	"rocket",
	"shadow",
	"signal",
	"sparrow",
	"summit",
	"thunder",
	"valley",
	"voyage",
] as const;

type WorktreeNameOptions = {
	randomInt?: (max: number) => number;
};

const createRandomInt = (): ((max: number) => number) => {
	const cryptoRef = globalThis.crypto;
	if (cryptoRef?.getRandomValues) {
		return (max) => {
			if (!Number.isInteger(max) || max <= 0) {
				throw new Error("max must be a positive integer");
			}
			const values = new Uint32Array(1);
			cryptoRef.getRandomValues(values);
			return values[0] % max;
		};
	}
	return (max) => {
		if (!Number.isInteger(max) || max <= 0) {
			throw new Error("max must be a positive integer");
		}
		return Math.floor(Math.random() * max);
	};
};

export const generateDefaultWorktreeBranchName = (
	options?: WorktreeNameOptions,
): string => {
	const randomInt = options?.randomInt ?? createRandomInt();
	const adjective = WORKTREE_ADJECTIVES[randomInt(WORKTREE_ADJECTIVES.length)];
	const noun = WORKTREE_NOUNS[randomInt(WORKTREE_NOUNS.length)];
	const suffix = randomInt(36 ** 2)
		.toString(36)
		.padStart(2, "0");
	return `${adjective}-${noun}-${suffix}`;
};

export const resolveWorktreeBranchName = (
	branch?: string | null,
	options?: WorktreeNameOptions,
): string => {
	const trimmed = branch?.trim();
	return trimmed ? trimmed : generateDefaultWorktreeBranchName(options);
};

export const sanitizeWorktreeBranchForPath = (branch: string): string =>
	branch.replace(/[/\\]/g, "-");
