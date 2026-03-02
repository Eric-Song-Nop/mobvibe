import { type ComponentType, lazy, Suspense } from "react";
import type { StreamdownProps } from "streamdown";

const StreamdownLazy = lazy(async () => {
	const mod = await import("streamdown");
	const Original = mod.Streamdown as ComponentType<StreamdownProps>;
	const Themed = (props: StreamdownProps) => (
		<Original
			{...props}
			shikiTheme={["gruvbox-light-medium", "gruvbox-dark-medium"]}
		/>
	);
	return { default: Themed };
});

function StreamdownFallback({ children }: StreamdownProps) {
	return <span className="whitespace-pre-wrap">{children}</span>;
}

export function LazyStreamdown(props: StreamdownProps) {
	return (
		<Suspense fallback={<StreamdownFallback {...props} />}>
			<StreamdownLazy {...props} />
		</Suspense>
	);
}
