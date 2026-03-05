const FOREGROUND_FLAGS = new Set(["--foreground", "-f"]);

const isBunVirtualEntrypoint = (arg: string): boolean =>
	arg.startsWith("/$bunfs/");

export const buildForegroundSpawnArgs = (execArgv: string[]): string[] => {
	const scriptOrCommandArg = execArgv[1];
	const passthroughArgs = execArgv
		.slice(2)
		.filter((arg) => !FOREGROUND_FLAGS.has(arg));

	const args: string[] = [];

	if (
		typeof scriptOrCommandArg === "string" &&
		!isBunVirtualEntrypoint(scriptOrCommandArg) &&
		!FOREGROUND_FLAGS.has(scriptOrCommandArg)
	) {
		args.push(scriptOrCommandArg);
	}

	args.push(...passthroughArgs);
	args.push("--foreground");

	return args;
};
