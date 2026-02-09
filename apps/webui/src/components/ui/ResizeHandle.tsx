import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

type ResizeHandleProps = {
	onResize: (deltaX: number) => void;
	className?: string;
};

export function ResizeHandle({ onResize, className }: ResizeHandleProps) {
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

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			onPointerDown={handlePointerDown}
			className={cn(
				"w-1.5 cursor-col-resize bg-transparent hover:bg-border/60 active:bg-border/80",
				className,
			)}
		/>
	);
}
