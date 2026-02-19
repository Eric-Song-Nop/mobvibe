import { type ComponentType, lazy, Suspense } from "react";

type StreamdownProps = {
	children?: string;
};

const StreamdownLazy = lazy(async () => {
	const mod = await import("streamdown");
	return { default: mod.Streamdown as ComponentType<StreamdownProps> };
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
