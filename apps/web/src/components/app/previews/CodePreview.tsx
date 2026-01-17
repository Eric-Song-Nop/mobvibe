import type { Language, RenderProps, Token } from "prism-react-renderer";
import { Highlight, themes } from "prism-react-renderer";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { SessionFsFilePreviewResponse } from "@/lib/api";
import { resolveLanguageFromPath } from "@/lib/file-preview-utils";
import { cn } from "@/lib/utils";

export type CodePreviewProps = {
	payload: SessionFsFilePreviewResponse;
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

export function CodePreview({ payload }: CodePreviewProps) {
	const themeMode = useResolvedTheme();
	const language = useMemo(
		() => resolveLanguageFromPath(payload.path),
		[payload.path],
	);
	const code = useMemo(
		() => normalizeCode(payload.content ?? ""),
		[payload.content],
	);
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

	return (
		<div className="file-preview-code">
			<div className="file-preview-code__header">
				<span className="file-preview-code__badge">{language}</span>
				<span className="file-preview-code__meta">{`${lineCount} 行`}</span>
			</div>
			<div className="file-preview-code__body">
				<div className="file-preview-code__content" data-language={language}>
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
								tokens[tokens.length - 1].every((token) => token.content === "")
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
											>
												<span className="file-preview-code__line-number">
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
		</div>
	);
}
