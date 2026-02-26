import { afterEach, describe, expect, it, mock } from "bun:test";
import os from "node:os";
import { getRegistryPlatformKey } from "../platform.js";

// Save originals
const originalPlatform = os.platform;
const originalArch = os.arch;

afterEach(() => {
	os.platform = originalPlatform;
	os.arch = originalArch;
});

const mockPlatformArch = (platform: string, arch: string) => {
	os.platform = mock(() => platform as NodeJS.Platform);
	os.arch = mock(() => arch) as typeof os.arch;
};

describe("getRegistryPlatformKey", () => {
	it("returns darwin-aarch64 for macOS ARM", () => {
		mockPlatformArch("darwin", "arm64");
		expect(getRegistryPlatformKey()).toBe("darwin-aarch64");
	});

	it("returns darwin-x86_64 for macOS Intel", () => {
		mockPlatformArch("darwin", "x64");
		expect(getRegistryPlatformKey()).toBe("darwin-x86_64");
	});

	it("returns linux-aarch64 for Linux ARM", () => {
		mockPlatformArch("linux", "arm64");
		expect(getRegistryPlatformKey()).toBe("linux-aarch64");
	});

	it("returns linux-x86_64 for Linux x64", () => {
		mockPlatformArch("linux", "x64");
		expect(getRegistryPlatformKey()).toBe("linux-x86_64");
	});

	it("returns windows-aarch64 for Windows ARM", () => {
		mockPlatformArch("win32", "arm64");
		expect(getRegistryPlatformKey()).toBe("windows-aarch64");
	});

	it("returns windows-x86_64 for Windows x64", () => {
		mockPlatformArch("win32", "x64");
		expect(getRegistryPlatformKey()).toBe("windows-x86_64");
	});

	it("returns null for unsupported platform", () => {
		mockPlatformArch("freebsd", "x64");
		expect(getRegistryPlatformKey()).toBeNull();
	});

	it("returns null for unsupported architecture", () => {
		mockPlatformArch("linux", "s390x");
		expect(getRegistryPlatformKey()).toBeNull();
	});
});
