declare module "web-tree-sitter" {
	export class Parser {
		static init(moduleOptions?: {
			locateFile?: (scriptName: string) => string;
		}): Promise<void>;
		constructor();
		setLanguage(language: Language | null): this;
		parse(input: string): Tree | null;
	}

	export interface Language {}

	export namespace Language {
		function load(input: string | Uint8Array): Promise<Language>;
	}

	export type Point = { row: number; column: number };

	export class Node {
		startIndex: number;
		endIndex: number;
		startPosition: Point;
		text: string;
	}

	export type QueryCapture = { name: string; node: Node };

	export type QueryMatch = { captures: QueryCapture[] };

	export class Query {
		constructor(language: Language, source: string);
		matches(node: Node): QueryMatch[];
	}

	export class Tree {
		rootNode: Node;
		delete(): void;
	}
}
