import { cn } from "./utils.js";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="skeleton"
			className={cn("bg-muted rounded-none animate-pulse", className)}
			{...props}
		/>
	);
}

export { Skeleton };
