import { describe, expect, test } from "bun:test";
import { buildForegroundSpawnArgs } from "../spawn-utils.js";

describe("buildForegroundSpawnArgs", () => {
	test("keeps script path for interpreted runtime", () => {
		expect(
			buildForegroundSpawnArgs([
				"/usr/local/bin/bun",
				"dist/index.js",
				"start",
				"--gateway",
				"https://api.mobvibe.net",
			]),
		).toEqual([
			"dist/index.js",
			"start",
			"--gateway",
			"https://api.mobvibe.net",
			"--foreground",
		]);
	});

	test("drops Bun virtual entrypoint from compiled binary argv", () => {
		expect(
			buildForegroundSpawnArgs([
				"/private/tmp/mobvibe",
				"/$bunfs/root/mobvibe",
				"start",
			]),
		).toEqual(["start", "--foreground"]);
	});

	test("removes existing foreground flags before re-adding", () => {
		expect(
			buildForegroundSpawnArgs([
				"/private/tmp/mobvibe",
				"start",
				"--foreground",
				"--gateway",
				"https://api.mobvibe.net",
				"-f",
			]),
		).toEqual([
			"start",
			"--gateway",
			"https://api.mobvibe.net",
			"--foreground",
		]);
	});

	test("preserves no-e2ee flag when respawning in foreground", () => {
		expect(
			buildForegroundSpawnArgs(["/private/tmp/mobvibe", "start", "--no-e2ee"]),
		).toEqual(["start", "--no-e2ee", "--foreground"]);
	});
});
