import { PROMPT_IMAGE_MAX_BYTES } from "@mobvibe/shared";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { normalizeImageFileForPrompt } from "../prompt-images";

type MockImageState = { naturalWidth: number; naturalHeight: number } | "error";

type CanvasBlobRequest = {
	type: string;
	quality: number | undefined;
	width: number;
	height: number;
};

let blobDataUrls = new WeakMap<Blob, string>();
const imageStates = new Map<string, MockImageState>();
const mockContext = {
	clearRect: vi.fn(),
	drawImage: vi.fn(),
};

let canvasContext: typeof mockContext | null = mockContext;
let canvasBlobFactory: (request: CanvasBlobRequest) => Blob | null;
let originalFileReader: typeof FileReader | undefined;
let originalImage: typeof Image | undefined;

const registerDataUrl = <T extends Blob>(blob: T, dataUrl: string): T => {
	blobDataUrls.set(blob, dataUrl);
	return blob;
};

const createBlob = ({
	type,
	dataUrl,
	size = 16,
}: {
	type: string;
	dataUrl: string;
	size?: number;
}) => registerDataUrl(new Blob([new Uint8Array(size)], { type }), dataUrl);

class MockFileReader {
	result: string | ArrayBuffer | null = null;
	error: DOMException | null = null;
	onload:
		| ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
		| null = null;
	onerror:
		| ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown)
		| null = null;

	readAsDataURL(blob: Blob) {
		const dataUrl = blobDataUrls.get(blob);
		if (!dataUrl) {
			this.error = new DOMException("Missing mocked data URL");
			this.onerror?.call(this as never, new ProgressEvent("error"));
			return;
		}
		this.result = dataUrl;
		this.onload?.call(this as never, new ProgressEvent("load"));
	}
}

class MockImage {
	naturalWidth = 0;
	naturalHeight = 0;
	onload: ((this: GlobalImage, ev: Event) => unknown) | null = null;
	onerror: ((this: GlobalImage, ev: Event) => unknown) | null = null;

	set src(value: string) {
		const state = imageStates.get(value);
		queueMicrotask(() => {
			if (!state || state === "error") {
				this.onerror?.call(this as never, new Event("error"));
				return;
			}
			this.naturalWidth = state.naturalWidth;
			this.naturalHeight = state.naturalHeight;
			this.onload?.call(this as never, new Event("load"));
		});
	}
}

type GlobalImage = InstanceType<typeof Image>;

describe("prompt-images", () => {
	beforeAll(() => {
		originalFileReader = globalThis.FileReader;
		originalImage = globalThis.Image;
		Object.defineProperty(globalThis, "FileReader", {
			configurable: true,
			value: MockFileReader,
		});
		Object.defineProperty(globalThis, "Image", {
			configurable: true,
			value: MockImage,
		});
	});

	afterAll(() => {
		if (originalFileReader) {
			Object.defineProperty(globalThis, "FileReader", {
				configurable: true,
				value: originalFileReader,
			});
		}
		if (originalImage) {
			Object.defineProperty(globalThis, "Image", {
				configurable: true,
				value: originalImage,
			});
		}
	});

	beforeEach(() => {
		blobDataUrls = new WeakMap<Blob, string>();
		imageStates.clear();
		mockContext.clearRect.mockReset();
		mockContext.drawImage.mockReset();
		canvasContext = mockContext;
		canvasBlobFactory = ({ type }) =>
			createBlob({
				type,
				dataUrl: `data:${type};base64,bm9ybQ==`,
				size: 64,
			});
		vi.restoreAllMocks();

		const originalCreateElement = document.createElement.bind(document);
		vi.spyOn(document, "createElement").mockImplementation(((
			tagName: string,
			options?: ElementCreationOptions,
		) => {
			if (tagName !== "canvas") {
				return originalCreateElement(tagName, options);
			}
			const canvas = {
				width: 0,
				height: 0,
				getContext: vi.fn(() => canvasContext),
				toBlob: (callback: BlobCallback, type?: string, quality?: number) => {
					callback(
						canvasBlobFactory({
							type: type ?? "image/png",
							quality,
							width: (canvas as { width: number }).width,
							height: (canvas as { height: number }).height,
						}),
					);
				},
			} as HTMLCanvasElement;
			return canvas;
		}) as typeof document.createElement);
	});

	it("rejects unsupported MIME types before normalization starts", async () => {
		const file = new File(["svg"], "demo.svg", { type: "image/svg+xml" });

		await expect(normalizeImageFileForPrompt(file)).rejects.toThrow(
			"Unsupported image MIME type: image/svg+xml",
		);
	});

	it("passes through GIF images without raster normalization", async () => {
		const file = registerDataUrl(
			new File(["gif"], "demo.gif", { type: "image/gif" }),
			"data:image/gif;base64,R0lGODlhAQABAAAAACw=",
		);

		await expect(normalizeImageFileForPrompt(file)).resolves.toEqual({
			type: "image",
			mimeType: "image/gif",
			data: "R0lGODlhAQABAAAAACw=",
			uri: null,
		});
		expect(mockContext.drawImage).not.toHaveBeenCalled();
	});

	it("normalizes raster images and returns the prompt image block shape", async () => {
		const file = registerDataUrl(
			new File(["png"], "demo.png", { type: "image/png" }),
			"data:image/png;base64,aW5wdXQ=",
		);
		imageStates.set("data:image/png;base64,aW5wdXQ=", {
			naturalWidth: 2400,
			naturalHeight: 1200,
		});
		canvasBlobFactory = ({ type, width, height }) => {
			expect(type).toBe("image/png");
			expect(width).toBe(1600);
			expect(height).toBe(800);
			return createBlob({
				type,
				dataUrl: "data:image/png;base64,bm9ybWFsaXplZA==",
				size: 128,
			});
		};

		await expect(normalizeImageFileForPrompt(file)).resolves.toEqual({
			type: "image",
			mimeType: "image/png",
			data: "bm9ybWFsaXplZA==",
			uri: null,
		});
		expect(mockContext.drawImage).toHaveBeenCalled();
	});

	it("surfaces decode failures from the browser image element", async () => {
		const file = registerDataUrl(
			new File(["png"], "broken.png", { type: "image/png" }),
			"data:image/png;base64,YnJva2Vu",
		);
		imageStates.set("data:image/png;base64,YnJva2Vu", "error");

		await expect(normalizeImageFileForPrompt(file)).rejects.toThrow(
			"Failed to decode image",
		);
	});

	it("fails when a canvas context cannot be created", async () => {
		const file = registerDataUrl(
			new File(["png"], "demo.png", { type: "image/png" }),
			"data:image/png;base64,aW5wdXQ=",
		);
		imageStates.set("data:image/png;base64,aW5wdXQ=", {
			naturalWidth: 800,
			naturalHeight: 600,
		});
		canvasContext = null;

		await expect(normalizeImageFileForPrompt(file)).rejects.toThrow(
			"Failed to create image canvas",
		);
	});

	it("fails when the canvas cannot encode an output blob", async () => {
		const file = registerDataUrl(
			new File(["jpeg"], "demo.jpg", { type: "image/jpeg" }),
			"data:image/jpeg;base64,aW5wdXQ=",
		);
		imageStates.set("data:image/jpeg;base64,aW5wdXQ=", {
			naturalWidth: 800,
			naturalHeight: 600,
		});
		canvasBlobFactory = () => null;

		await expect(normalizeImageFileForPrompt(file)).rejects.toThrow(
			"Failed to encode image",
		);
	});

	it("fails when every normalized output still exceeds the size limit", async () => {
		const file = registerDataUrl(
			new File(["png"], "too-large.png", { type: "image/png" }),
			"data:image/png;base64,aW5wdXQ=",
		);
		imageStates.set("data:image/png;base64,aW5wdXQ=", {
			naturalWidth: 2000,
			naturalHeight: 1200,
		});
		canvasBlobFactory = ({ type }) =>
			new Blob([new Uint8Array(PROMPT_IMAGE_MAX_BYTES + 1)], { type });

		await expect(normalizeImageFileForPrompt(file)).rejects.toThrow(
			`Image exceeds ${PROMPT_IMAGE_MAX_BYTES / 1024} KiB after normalization`,
		);
	});
});
