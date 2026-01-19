import type { Language, RenderProps, Token } from "prism-react-renderer";
import { Highlight, themes } from "prism-react-renderer";
import type { CSSProperties, PointerEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Node, QueryCapture, QueryMatch } from "web-tree-sitter";
import { Parser, Query, Language as TreeSitterLanguage } from "web-tree-sitter";
import { Button } from "@/components/ui/button";
import type { SessionFsFilePreviewResponse } from "@/lib/api";
import { resolveLanguageFromPath } from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

export type CodePreviewProps = {
	payload: SessionFsFilePreviewResponse;
};

type OutlineLanguage =
	| "bash"
	| "c"
	| "cpp"
	| "csharp"
	| "go"
	| "java"
	| "javascript"
	| "php"
	| "python"
	| "ruby"
	| "rust"
	| "typescript"
	| "tsx";

type OutlineKind =
	| "class"
	| "method"
	| "function"
	| "interface"
	| "type"
	| "enum"
	| "module"
	| "constant"
	| "property"
	| "field"
	| "constructor"
	| "variable"
	| "struct";

type OutlineItem = {
	id: string;
	label: string;
	kind: OutlineKind;
	startIndex: number;
	endIndex: number;
	startLine: number;
	children: OutlineItem[];
};

type OutlineStatus = "idle" | "loading" | "ready" | "unsupported" | "error";

const OUTLINE_KIND_LABELS: Record<OutlineKind, string> = {
	class: "Class",
	method: "Method",
	function: "Function",
	interface: "Interface",
	type: "Type",
	enum: "Enum",
	module: "Module",
	constant: "Const",
	property: "Property",
	field: "Field",
	constructor: "Constructor",
	variable: "Variable",
	struct: "Struct",
};

const JAVASCRIPT_OUTLINE_QUERY = String.raw`
(
  (method_definition
    name: [(property_identifier) (private_property_identifier)] @name) @definition.method
  (#not-eq? @name "constructor")
)

(
  [
    (class
      name: (_) @name)
    (class_declaration
      name: (_) @name)
  ] @definition.class
)

(
  [
    (function_expression
      name: (identifier) @name)
    (function_declaration
      name: (identifier) @name)
    (generator_function
      name: (identifier) @name)
    (generator_function_declaration
      name: (identifier) @name)
  ] @definition.function
)

(
  (lexical_declaration
    (variable_declarator
      name: (identifier) @name
      value: [(arrow_function) (function_expression)])) @definition.function
)

(
  (variable_declaration
    (variable_declarator
      name: (identifier) @name
      value: [(arrow_function) (function_expression)])) @definition.function
)

(assignment_expression
  left: [
    (identifier) @name
    (member_expression
      property: (property_identifier) @name)
  ]
  right: [(arrow_function) (function_expression)]
) @definition.function

(pair
  key: (property_identifier) @name
  value: [(arrow_function) (function_expression)]) @definition.function
`;

const TYPESCRIPT_OUTLINE_QUERY = String.raw`
${JAVASCRIPT_OUTLINE_QUERY}

(interface_declaration
  name: (type_identifier) @name) @definition.interface

(type_alias_declaration
  name: (type_identifier) @name) @definition.type

(enum_declaration
  name: (identifier) @name) @definition.enum

(module
  name: (identifier) @name) @definition.module
`;

const BASH_OUTLINE_QUERY = String.raw`
(function_definition
  name: (word) @name) @definition.function
`;

const C_OUTLINE_QUERY = String.raw`
(type_definition
  type: (enum_specifier) @definition.enum
  declarator: (type_identifier) @name)

(type_definition
  type: (struct_specifier) @definition.struct
  declarator: (type_identifier) @name)

(struct_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition.struct

(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name)) @definition.function

(function_definition
  declarator: (pointer_declarator
    declarator: (function_declarator
      declarator: (identifier) @name))) @definition.function
`;

const CPP_OUTLINE_QUERY = String.raw`
(struct_specifier
  name: (type_identifier) @name
  body: (field_declaration_list)) @definition.struct

(declaration
  (struct_specifier
    body: (field_declaration_list))
  declarator: (identifier) @name) @definition.struct

(function_declarator
  declarator: (_) @name) @definition.function

(enum_specifier
  name: (type_identifier) @name) @definition.enum

(class_specifier
  name: (type_identifier) @name) @definition.class
`;

const CSHARP_OUTLINE_QUERY = String.raw`
(interface_declaration
  name: (identifier) @name) @definition.interface

(class_declaration
  name: (identifier) @name) @definition.class

(struct_declaration
  name: (identifier) @name) @definition.struct

(method_declaration
  name: (identifier) @name) @definition.method

(enum_declaration
  name: (identifier) @name) @definition.enum

(constructor_declaration
  name: (identifier) @name) @definition.constructor

(property_declaration
  name: (identifier) @name) @definition.property

(field_declaration
  (variable_declaration
    (variable_declarator
      (identifier) @name))) @definition.field
`;

const GO_OUTLINE_QUERY = String.raw`
(function_declaration
  name: (identifier) @name) @definition.function

(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (struct_type)) @definition.struct)

(type_declaration
  (type_spec
    name: (type_identifier) @name
    type: (interface_type)) @definition.interface)

(method_declaration
  receiver: (_)
  name: (field_identifier) @name) @definition.method
`;

const JAVA_OUTLINE_QUERY = String.raw`
(interface_declaration
  name: (identifier) @name) @definition.interface

(method_declaration
  name: (identifier) @name) @definition.method

(constructor_declaration
  name: (identifier) @name) @definition.constructor

(class_declaration
  name: (identifier) @name) @definition.class

(enum_declaration
  name: (identifier) @name) @definition.enum

(field_declaration
  declarator: (variable_declarator
    name: (identifier) @name)) @definition.field
`;

const PHP_OUTLINE_QUERY = String.raw`
(function_definition
  name: (name) @name) @definition.function

(expression_statement
  (assignment_expression
    left: (variable_name) @name
    right: (anonymous_function))) @definition.function

(class_declaration
  name: (name) @name) @definition.class

(method_declaration
  name: (name) @name) @definition.method

(interface_declaration
  name: (name) @name) @definition.interface

(trait_declaration
  name: (name) @name) @definition.class
`;

const PYTHON_OUTLINE_QUERY = String.raw`
(function_definition
  name: (identifier) @name) @definition.function

(class_definition
  name: (identifier) @name) @definition.class

(assignment
  left: (_) @name) @definition.variable
`;

const RUBY_OUTLINE_QUERY = String.raw`
(class
  name: [
    (constant)
    (scope_resolution)
  ] @name) @definition.class

(call
  ((identifier) @scope
    (#any-of? @scope "private" "protected" "public"))?
  .
  (argument_list
    (method
      name: (_) @name) )) @definition.method

(body_statement
  [
    (_)
    ((identifier) @scope
      (#any-of? @scope "private" "protected" "public"))
  ]*
  .
  (method
    name: (_) @name)) @definition.method

(body_statement
  (method
    name: (_) @name)) @definition.method

(singleton_method
  object: [
    (constant)
    (self)
    (identifier)
  ]
  ([
    "."
    "::"
  ])?
  name: [
    (operator)
    (identifier)
  ] @name) @definition.method

(singleton_class
  value: (_) @name) @definition.class

(module
  name: [
    (constant)
    (scope_resolution)
  ] @name) @definition.module

(call
  method: (identifier) @method @name
  (#any-of? @method
    "describe" "it" "before" "after"
    "namespace" "task" "multitask" "file"
    "setup" "teardown" "should" "should_not" "should_eventually" "context")
  arguments: (argument_list
    [
      (string
        (string_content) @name)
      (simple_symbol) @name
      (pair
        key: [
          (string
            (string_content) @name)
          (hash_key_symbol) @name
        ])
      (call) @name
    ])?) @definition.method
`;

const RUST_OUTLINE_QUERY = String.raw`
(mod_item
  name: (identifier) @name) @definition.module

(enum_item
  name: (type_identifier) @name) @definition.enum

(struct_item
  name: (type_identifier) @name) @definition.struct

(function_item
  name: (identifier) @name) @definition.function

(function_signature_item
  name: (identifier) @name) @definition.function

(trait_item
  name: (type_identifier) @name) @definition.interface

(impl_item
  trait: (type_identifier)?
  type: (type_identifier) @name) @definition.class

(impl_item
  trait: (type_identifier)?
  type: (generic_type
    type: (type_identifier) @name)) @definition.class
`;

const OUTLINE_LANGUAGE_CONFIG: Record<
	OutlineLanguage,
	{ wasmPath: string; query: string }
> = {
	bash: {
		wasmPath: "/tree-sitter-bash.wasm",
		query: BASH_OUTLINE_QUERY,
	},
	c: {
		wasmPath: "/tree-sitter-c.wasm",
		query: C_OUTLINE_QUERY,
	},
	cpp: {
		wasmPath: "/tree-sitter-cpp.wasm",
		query: CPP_OUTLINE_QUERY,
	},
	csharp: {
		wasmPath: "/tree-sitter-c_sharp.wasm",
		query: CSHARP_OUTLINE_QUERY,
	},
	go: {
		wasmPath: "/tree-sitter-go.wasm",
		query: GO_OUTLINE_QUERY,
	},
	java: {
		wasmPath: "/tree-sitter-java.wasm",
		query: JAVA_OUTLINE_QUERY,
	},
	javascript: {
		wasmPath: "/tree-sitter-javascript.wasm",
		query: JAVASCRIPT_OUTLINE_QUERY,
	},
	php: {
		wasmPath: "/tree-sitter-php.wasm",
		query: PHP_OUTLINE_QUERY,
	},
	python: {
		wasmPath: "/tree-sitter-python.wasm",
		query: PYTHON_OUTLINE_QUERY,
	},
	ruby: {
		wasmPath: "/tree-sitter-ruby.wasm",
		query: RUBY_OUTLINE_QUERY,
	},
	rust: {
		wasmPath: "/tree-sitter-rust.wasm",
		query: RUST_OUTLINE_QUERY,
	},
	typescript: {
		wasmPath: "/tree-sitter-typescript.wasm",
		query: TYPESCRIPT_OUTLINE_QUERY,
	},
	tsx: {
		wasmPath: "/tree-sitter-tsx.wasm",
		query: TYPESCRIPT_OUTLINE_QUERY,
	},
};

const resolveOutlineLanguage = (language: string): OutlineLanguage | null => {
	switch (language) {
		case "bash":
			return "bash";
		case "c":
			return "c";
		case "cpp":
			return "cpp";
		case "csharp":
			return "csharp";
		case "go":
			return "go";
		case "java":
			return "java";
		case "javascript":
		case "jsx":
			return "javascript";
		case "php":
			return "php";
		case "python":
			return "python";
		case "ruby":
			return "ruby";
		case "rust":
			return "rust";
		case "typescript":
			return "typescript";
		case "tsx":
			return "tsx";
		default:
			return null;
	}
};

let parserInitPromise: Promise<void> | null = null;
const outlineLanguageCache = new Map<OutlineLanguage, TreeSitterLanguage>();
const outlineQueryCache = new Map<OutlineLanguage, Query>();

const ensureParserReady = async () => {
	if (!parserInitPromise) {
		parserInitPromise = Parser.init({
			locateFile: (scriptName: string) => `/${scriptName}`,
		});
	}
	await parserInitPromise;
};

const loadOutlineLanguage = async (language: OutlineLanguage) => {
	const cached = outlineLanguageCache.get(language);
	if (cached) {
		return cached;
	}
	const { wasmPath } = OUTLINE_LANGUAGE_CONFIG[language];
	const loadedLanguage = await TreeSitterLanguage.load(wasmPath);
	outlineLanguageCache.set(language, loadedLanguage);
	return loadedLanguage;
};

const loadOutlineQuery = async (
	languageKey: OutlineLanguage,
	language: TreeSitterLanguage,
) => {
	const cached = outlineQueryCache.get(languageKey);
	if (cached) {
		return cached;
	}
	const query = new Query(language, OUTLINE_LANGUAGE_CONFIG[languageKey].query);
	outlineQueryCache.set(languageKey, query);
	return query;
};

const resolveOutlineKind = (captureName: string): OutlineKind | null => {
	if (!captureName.startsWith("definition.")) {
		return null;
	}
	const kind = captureName.replace("definition.", "");
	switch (kind) {
		case "class":
			return "class";
		case "method":
			return "method";
		case "function":
			return "function";
		case "interface":
			return "interface";
		case "type":
			return "type";
		case "enum":
			return "enum";
		case "module":
			return "module";
		case "constant":
			return "constant";
		case "property":
			return "property";
		case "field":
			return "field";
		case "constructor":
			return "constructor";
		case "variable":
			return "variable";
		case "struct":
			return "struct";
		default:
			return null;
	}
};

const normalizeOutlineLabel = (value: string) =>
	value.replace(/\s+/g, " ").trim();

const buildOutlineTree = (items: OutlineItem[]) => {
	const roots: OutlineItem[] = [];
	const stack: OutlineItem[] = [];
	items.forEach((item) => {
		while (
			stack.length > 0 &&
			item.startIndex >= stack[stack.length - 1].endIndex
		) {
			stack.pop();
		}
		const parent = stack[stack.length - 1];
		if (parent) {
			parent.children.push(item);
		} else {
			roots.push(item);
		}
		stack.push(item);
	});
	return roots;
};

const buildOutlineItems = (rootNode: Node, query: Query) => {
	const items: OutlineItem[] = [];
	query.matches(rootNode).forEach((match: QueryMatch) => {
		const definitionCapture = match.captures.find((capture: QueryCapture) =>
			capture.name.startsWith("definition."),
		);
		const nameCapture = match.captures.find(
			(capture: QueryCapture) => capture.name === "name",
		);
		if (!definitionCapture || !nameCapture) {
			return;
		}
		const kind = resolveOutlineKind(definitionCapture.name);
		if (!kind) {
			return;
		}
		const label = normalizeOutlineLabel(nameCapture.node.text);
		if (!label) {
			return;
		}
		const definitionNode = definitionCapture.node;
		items.push({
			id: `${kind}-${definitionNode.startIndex}-${definitionNode.endIndex}`,
			label,
			kind,
			startIndex: definitionNode.startIndex,
			endIndex: definitionNode.endIndex,
			startLine: definitionNode.startPosition.row + 1,
			children: [],
		});
	});
	const deduped = new Map<string, OutlineItem>();
	items.forEach((item) => {
		if (!deduped.has(item.id)) {
			deduped.set(item.id, item);
		}
	});
	const sorted = Array.from(deduped.values()).sort((a, b) => {
		if (a.startIndex !== b.startIndex) {
			return a.startIndex - b.startIndex;
		}
		return b.endIndex - a.endIndex;
	});
	return buildOutlineTree(sorted);
};

const useResolvedTheme = () => {
	const [theme, setTheme] = useState<"light" | "dark">("light");

	useEffect(() => {
		const root = document.documentElement;
		const updateTheme = () => {
			setTheme(root.classList.contains("dark") ? "dark" : "light");
		};

		updateTheme();

		const observer = new MutationObserver(() => updateTheme());
		observer.observe(root, { attributes: true, attributeFilter: ["class"] });
		return () => observer.disconnect();
	}, []);

	return theme;
};

const normalizeCode = (code: string) => {
	const trimmed = code.replace(/\t/g, "  ");
	return trimmed.length > 0 ? trimmed : " ";
};

const getTextSlice = (
	source: string,
	sourceBytes: Uint8Array | null,
	startIndex: number,
	endIndex: number,
	textDecoder: TextDecoder | null,
) => {
	const sourceLength = sourceBytes ? sourceBytes.length : source.length;
	const safeStart = Math.max(0, Math.min(startIndex, sourceLength));
	const safeEnd = Math.max(safeStart, Math.min(endIndex, sourceLength));
	if (!sourceBytes || !textDecoder) {
		return source.slice(safeStart, safeEnd);
	}
	const slice = sourceBytes.slice(safeStart, safeEnd);
	return textDecoder.decode(slice);
};

export function CodePreview({ payload }: CodePreviewProps) {
	const { t } = useTranslation();
	const themeMode = useResolvedTheme();
	const parserRef = useRef<Parser | null>(null);
	const codeContainerRef = useRef<HTMLDivElement | null>(null);
	const pressTimeoutRef = useRef<number | null>(null);
	const longPressItemIdRef = useRef<string | null>(null);
	const copyTimeoutRef = useRef<number | null>(null);

	const [outlineStatus, setOutlineStatus] = useState<OutlineStatus>("idle");
	const [outlineItems, setOutlineItems] = useState<OutlineItem[]>([]);
	const [collapsedIds, setCollapsedIds] = useState<Set<string>>(
		() => new Set(),
	);
	const [activePane, setActivePane] = useState<"code" | "outline">("code");
	const [copiedId, setCopiedId] = useState<string | null>(null);

	const filePath = payload.path;
	const sourceContent = payload.content ?? "";
	const language = useMemo(() => resolveLanguageFromPath(filePath), [filePath]);
	const outlineLanguage = useMemo(
		() => resolveOutlineLanguage(language),
		[language],
	);
	const code = useMemo(() => normalizeCode(sourceContent), [sourceContent]);
	const lineCount = useMemo(() => {
		const rawLines = code.split("\n");
		const count = code.endsWith("\n") ? rawLines.length - 1 : rawLines.length;
		return Math.max(count, 1);
	}, [code]);
	const prismLanguage = language as Language;
	const theme =
		themeMode === "dark"
			? themes.gruvboxMaterialDark
			: themes.gruvboxMaterialLight;
	const codeBytes = useMemo(() => {
		if (typeof TextEncoder === "undefined") {
			return null;
		}
		return new TextEncoder().encode(code);
	}, [code]);
	const textDecoder = useMemo(() => {
		if (typeof TextDecoder === "undefined") {
			return null;
		}
		return new TextDecoder();
	}, []);
	const canUseTreeSitter =
		outlineLanguage !== null &&
		typeof window !== "undefined" &&
		typeof window.fetch === "function" &&
		typeof window.WebAssembly !== "undefined" &&
		(import.meta.env.MODE !== "test" ||
			Boolean(
				(globalThis as { __ENABLE_TREESITTER_TESTS__?: boolean })
					.__ENABLE_TREESITTER_TESTS__,
			));

	const outlineSnapshotRef = useRef<{ path: string; content: string } | null>(
		null,
	);

	useEffect(() => {
		const nextSnapshot = { path: filePath, content: sourceContent };
		const previousSnapshot = outlineSnapshotRef.current;
		if (
			previousSnapshot &&
			previousSnapshot.path === nextSnapshot.path &&
			previousSnapshot.content === nextSnapshot.content
		) {
			return;
		}
		outlineSnapshotRef.current = nextSnapshot;
		setActivePane("code");
		setCollapsedIds(new Set());
		setCopiedId(null);
	}, [filePath, sourceContent]);

	useEffect(() => {
		if (!outlineLanguage || !canUseTreeSitter) {
			setOutlineItems([]);
			setOutlineStatus("unsupported");
			return;
		}
		let cancelled = false;
		setOutlineStatus("loading");
		void (async () => {
			try {
				await ensureParserReady();
				if (cancelled) {
					return;
				}
				const parser = parserRef.current ?? new Parser();
				parserRef.current = parser;
				let languageInstance: TreeSitterLanguage;
				try {
					languageInstance = await loadOutlineLanguage(outlineLanguage);
				} catch (error) {
					if (!cancelled) {
						setOutlineItems([]);
						setOutlineStatus("unsupported");
					}
					return;
				}
				const query = await loadOutlineQuery(outlineLanguage, languageInstance);
				parser.setLanguage(languageInstance);
				const tree = parser.parse(code);
				if (!tree) {
					if (!cancelled) {
						setOutlineItems([]);
						setOutlineStatus("error");
					}
					return;
				}
				const items = buildOutlineItems(tree.rootNode, query);
				tree.delete();
				if (cancelled) {
					return;
				}
				setOutlineItems(items);
				setOutlineStatus("ready");
			} catch (error) {
				if (!cancelled) {
					setOutlineItems([]);
					setOutlineStatus("error");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [code, outlineLanguage, canUseTreeSitter]);

	const handleToggleCollapse = (id: string) => {
		setCollapsedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const handleOutlineJump = (line: number) => {
		const container = codeContainerRef.current;
		if (!container) {
			return;
		}
		const target = container.querySelector<HTMLElement>(
			`[data-line="${line}"]`,
		);
		if (!target) {
			return;
		}
		target.scrollIntoView({ block: "start", behavior: "smooth" });
	};

	const copyOutlineItem = async (item: OutlineItem) => {
		const text = getTextSlice(
			code,
			codeBytes,
			item.startIndex,
			item.endIndex,
			textDecoder,
		);
		if (!text) {
			return;
		}
		if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
		} else if (typeof document !== "undefined") {
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.setAttribute("readonly", "true");
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			document.execCommand("copy");
			document.body.removeChild(textarea);
		}
		setCopiedId(item.id);
		if (copyTimeoutRef.current) {
			window.clearTimeout(copyTimeoutRef.current);
		}
		copyTimeoutRef.current = window.setTimeout(() => {
			setCopiedId((current) => (current === item.id ? null : current));
		}, 1200);
	};

	const clearPressTimer = () => {
		if (pressTimeoutRef.current) {
			window.clearTimeout(pressTimeoutRef.current);
			pressTimeoutRef.current = null;
		}
	};

	const handlePressStart = (item: OutlineItem) => {
		return (event: PointerEvent<HTMLButtonElement>) => {
			if (event.pointerType === "mouse" && event.button !== 0) {
				return;
			}
			clearPressTimer();
			longPressItemIdRef.current = null;
			pressTimeoutRef.current = window.setTimeout(() => {
				pressTimeoutRef.current = null;
				longPressItemIdRef.current = item.id;
				void copyOutlineItem(item);
			}, 450);
		};
	};

	const handlePressEnd = () => {
		clearPressTimer();
	};

	const handleItemClick = (item: OutlineItem) => {
		if (longPressItemIdRef.current === item.id) {
			longPressItemIdRef.current = null;
			return;
		}
		handleOutlineJump(item.startLine);
	};

	const renderOutlineItems = (items: OutlineItem[], depth = 0) => {
		return (
			<ul
				className="file-preview-outline__list"
				role={depth === 0 ? "tree" : "group"}
			>
				{items.map((item) => {
					const hasChildren = item.children.length > 0;
					const isCollapsed = collapsedIds.has(item.id);
					return (
						<li
							key={item.id}
							className="file-preview-outline__node"
							role="treeitem"
							aria-level={depth + 1}
							aria-expanded={hasChildren ? !isCollapsed : undefined}
						>
							<div
								className="file-preview-outline__row"
								style={{ paddingLeft: `${depth * 12}px` }}
							>
								{hasChildren ? (
									<Button
										variant="ghost"
										size="icon-xs"
										className="file-preview-outline__toggle"
										onClick={(event) => {
											event.stopPropagation();
											handleToggleCollapse(item.id);
										}}
										aria-label={
											isCollapsed
												? t("codePreview.expand")
												: t("codePreview.collapse")
										}
										title={
											isCollapsed
												? t("codePreview.expand")
												: t("codePreview.collapse")
										}
									>
										<span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
									</Button>
								) : (
									<span className="file-preview-outline__toggle-spacer" />
								)}
								<Button
									variant="ghost"
									size="xs"
									className={cn(
										"file-preview-outline__item",
										copiedId === item.id &&
											"file-preview-outline__item--copied",
									)}
									onClick={() => handleItemClick(item)}
									onPointerDown={handlePressStart(item)}
									onPointerUp={handlePressEnd}
									onPointerLeave={handlePressEnd}
									onPointerCancel={handlePressEnd}
									title={`${item.label} · ${OUTLINE_KIND_LABELS[item.kind]} (${t("codePreview.longPressCopy")})`}
									aria-label={`${item.label} · ${OUTLINE_KIND_LABELS[item.kind]}`}
								>
									<span className="file-preview-outline__label">
										{item.label}
									</span>
									<span className="file-preview-outline__kind">
										{OUTLINE_KIND_LABELS[item.kind]}
									</span>
								</Button>
							</div>
							{hasChildren && !isCollapsed
								? renderOutlineItems(item.children, depth + 1)
								: null}
						</li>
					);
				})}
			</ul>
		);
	};

	const renderOutlineBody = () => {
		switch (outlineStatus) {
			case "loading":
				return (
					<div className="file-preview-outline__empty">
						{t("codePreview.outlineLoading")}
					</div>
				);
			case "unsupported":
				return (
					<div className="file-preview-outline__empty">
						{t("codePreview.outlineUnsupported")}
					</div>
				);
			case "error":
				return (
					<div className="file-preview-outline__empty">
						{t("codePreview.outlineFailed")}
					</div>
				);
			case "ready":
				return outlineItems.length > 0 ? (
					renderOutlineItems(outlineItems)
				) : (
					<div className="file-preview-outline__empty">
						{t("codePreview.outlineEmpty")}
					</div>
				);
			case "idle":
			default:
				return (
					<div className="file-preview-outline__empty">
						{t("codePreview.outlineEmpty")}
					</div>
				);
		}
	};

	return (
		<div className="file-preview-code">
			<div className="file-preview-code__header">
				<span className="file-preview-code__badge">{language}</span>
				<span className="file-preview-code__meta">
					{t("codePreview.lineCount", { count: lineCount })}
				</span>
			</div>
			<div className="file-preview-code__body">
				<div className="file-preview-code__toolbar">
					<Button
						variant={activePane === "code" ? "secondary" : "outline"}
						size="sm"
						onClick={() => setActivePane("code")}
					>
						{t("codePreview.code")}
					</Button>
					<Button
						variant={activePane === "outline" ? "secondary" : "outline"}
						size="sm"
						onClick={() => setActivePane("outline")}
						disabled={outlineStatus === "unsupported"}
					>
						{t("codePreview.outline")}
					</Button>
				</div>
				<div className="file-preview-code__layout">
					<div
						className="file-preview-code__panel file-preview-code__panel--code"
						data-active={activePane === "code"}
					>
						<div
							className="file-preview-code__content"
							data-language={language}
							ref={codeContainerRef}
						>
							<Highlight code={code} language={prismLanguage} theme={theme}>
								{({
									className,
									style,
									tokens,
									getLineProps,
									getTokenProps,
								}: {
									className: string;
									style: CSSProperties;
									tokens: Token[][];
									getLineProps: RenderProps["getLineProps"];
									getTokenProps: RenderProps["getTokenProps"];
								}) => {
									const shouldTrimLastLine = code.endsWith("\n");
									const renderTokens =
										shouldTrimLastLine &&
										tokens.length > 0 &&
										tokens[tokens.length - 1].every(
											(token) => token.content === "",
										)
											? tokens.slice(0, -1)
											: tokens;

									return (
										<pre
											className={cn("file-preview-code__pre", className)}
											style={style}
										>
											{renderTokens.map((line: Token[], lineIndex: number) => {
												const lineProps = getLineProps({
													line,
													key: lineIndex,
												});
												const { className: lineClassName, ...restLineProps } =
													lineProps;
												return (
													<div
														key={`line-${lineIndex}`}
														className="file-preview-code__line"
														data-line={lineIndex + 1}
													>
														<span
															className="file-preview-code__line-number"
															aria-hidden="true"
														>
															{lineIndex + 1}
														</span>
														<span
															{...restLineProps}
															className={cn(
																"file-preview-code__line-content",
																lineClassName,
															)}
														>
															{line.map((token: Token, tokenIndex: number) => (
																<span
																	key={`token-${lineIndex}-${tokenIndex}`}
																	{...getTokenProps({ token, key: tokenIndex })}
																/>
															))}
														</span>
													</div>
												);
											})}
										</pre>
									);
								}}
							</Highlight>
						</div>
					</div>
					<aside
						className="file-preview-code__panel file-preview-code__panel--outline"
						data-active={activePane === "outline"}
					>
						<div className="file-preview-outline">
							<div className="file-preview-outline__header">
								<span className="file-preview-outline__title">
									{t("codePreview.outlineTitle")}
								</span>
								<span className="file-preview-outline__hint">
									{t("codePreview.outlineHint")}
								</span>
							</div>
							<div className="file-preview-outline__body">
								{renderOutlineBody()}
							</div>
						</div>
					</aside>
				</div>
			</div>
		</div>
	);
}
