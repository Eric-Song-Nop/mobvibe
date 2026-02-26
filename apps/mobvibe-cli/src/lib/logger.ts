import pino from "pino";
import PinoPretty from "pino-pretty";

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

// Use pino-pretty's synchronous Transform stream instead of pino.transport()
// to avoid thread-stream Worker path resolution failures in compiled binaries.
const prettyStream = isPretty
	? PinoPretty({
			colorize: true,
			translateTime: "SYS:standard",
			ignore: "pid,hostname",
		})
	: undefined;

export const logger = pino(
	{
		level: LOG_LEVEL,
		redact,
		base: { service: "mobvibe-cli" },
		serializers: {
			err: pino.stdSerializers.err,
			error: pino.stdSerializers.err,
		},
	},
	prettyStream,
);
