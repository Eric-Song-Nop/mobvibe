import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const isPretty = process.env.NODE_ENV !== "production";

const redact = {
	paths: [
		"req.headers.authorization",
		"req.headers.cookie",
		"req.headers['x-api-key']",
		"headers.authorization",
		"headers.cookie",
		"headers['x-api-key']",
		"apiKey",
		"token",
	],
	censor: "[redacted]",
};

const transport = isPretty
	? {
			target: "pino-pretty",
			options: {
				colorize: true,
				translateTime: "SYS:standard",
				ignore: "pid,hostname",
			},
		}
	: undefined;

export const logger = pino(
	{
		level: LOG_LEVEL,
		redact,
		base: { service: "gateway" },
	},
	transport ? pino.transport(transport) : undefined,
);
