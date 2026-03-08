import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

export type ExecFileAsyncOptions = {
	cwd: string;
	maxBuffer: number;
};

export type ExecFileAsyncResult = {
	stdout: string;
	stderr: string;
};

const execFilePromise = promisify(execFile);

export function execFileAsync(
	file: string,
	args: string[],
	options: ExecFileAsyncOptions,
): Promise<ExecFileAsyncResult> {
	return execFilePromise(file, args, options);
}

export function readFileText(
	filePath: string,
	encoding: BufferEncoding,
): Promise<string> {
	return readFile(filePath, encoding);
}
