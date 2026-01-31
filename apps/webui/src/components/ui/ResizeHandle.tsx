import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

type ResizeHandleProps = {
	onResize: (deltaX: number) => void;
	className?: string;
};

export function ResizeHandle({ onResize, className }: ResizeHandleProps) {
	const dragState = useRef<{ startX: number } | null>(null);

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			if (!dragState.current) {
				return;
			}
			const deltaX = event.clientX - dragState.current.startX;
			dragState.current.startX = event.clientX;
			onResize(deltaX);
		};

		const handlePointerUp = () => {
			dragState.current = null;
		};

		window.addEventListener("pointermove", handlePointerMove);
		window.addEventListener("pointerup", handlePointerUp);
		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("pointerup", handlePointerUp);
		};
	}, [onResize]);

	return (
		<div
			role="separator"
			aria-orientation="vertical"
			onPointerDown={(event) => {
				dragState.current = { startX: event.clientX };
			}}
			className={cn(
				"w-1.5 cursor-col-resize bg-transparent hover:bg-border/60 active:bg-border/80",
				className,
			)}
		/>
	);
}
