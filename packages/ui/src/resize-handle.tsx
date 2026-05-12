import {
	type ComponentProps,
	type KeyboardEvent,
	useCallback,
	useRef,
} from "react";
import { cn } from "./utils.js";

type ResizeHandleProps = Omit<ComponentProps<"hr">, "onResize"> & {
	onResize: (deltaX: number) => void;
	step?: number;
};

export function ResizeHandle({
	onResize,
	step = 24,
	className,
	...props
}: ResizeHandleProps) {
	const onResizeRef = useRef(onResize);
	onResizeRef.current = onResize;
	const dragState = useRef<{ startX: number } | null>(null);

	const handlePointerDown = useCallback((event: React.PointerEvent) => {
		dragState.current = { startX: event.clientX };
		const onMove = (e: PointerEvent) => {
			if (!dragState.current) return;
			const delta = e.clientX - dragState.current.startX;
			dragState.current.startX = e.clientX;
			onResizeRef.current(delta);
		};
		const onUp = () => {
			dragState.current = null;
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLHRElement>) => {
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				onResizeRef.current(-step);
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				onResizeRef.current(step);
			}
		},
		[step],
	);

	return (
		<hr
			tabIndex={0}
			aria-orientation="vertical"
			aria-valuenow={0}
			onPointerDown={handlePointerDown}
			onKeyDown={handleKeyDown}
			className={cn(
				"h-auto w-1.5 cursor-col-resize self-stretch border-0 bg-transparent hover:bg-border/60 active:bg-border/80",
				className,
			)}
			{...props}
		/>
	);
}
