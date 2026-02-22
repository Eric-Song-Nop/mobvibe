import { CancelCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Toast as ToastPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils";

function ToastProvider({
	...props
}: React.ComponentProps<typeof ToastPrimitive.Provider>) {
	return <ToastPrimitive.Provider data-slot="toast-provider" {...props} />;
}

function ToastViewport({
	className,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Viewport>) {
	return (
		<ToastPrimitive.Viewport
			data-slot="toast-viewport"
			className={cn(
				"fixed top-[calc(1rem+env(safe-area-inset-top))] right-4 z-50 flex max-h-screen w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 outline-none",
				className,
			)}
			{...props}
		/>
	);
}

const toastVariants = {
	default: "border-border bg-background text-foreground",
	info: "border-border bg-background text-foreground",
	success: "border-border bg-background text-foreground",
	warning:
		"border-border bg-secondary text-secondary-foreground dark:bg-secondary",
	error:
		"border-destructive/40 bg-destructive/10 text-destructive dark:bg-destructive/20",
} as const;

type ToastVariant = keyof typeof toastVariants;

type ToastProps = React.ComponentProps<typeof ToastPrimitive.Root> & {
	variant?: ToastVariant;
};

function Toast({ className, variant = "default", ...props }: ToastProps) {
	return (
		<ToastPrimitive.Root
			data-slot="toast"
			data-variant={variant}
			className={cn(
				"group/toast relative flex w-full items-start gap-3 rounded-none border px-3 py-2 text-xs shadow-lg transition-[opacity,transform] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[swipe=end]:animate-out data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=cancel]:translate-x-0 data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)]",
				toastVariants[variant],
				className,
			)}
			{...props}
		/>
	);
}

function ToastTitle({
	className,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Title>) {
	return (
		<ToastPrimitive.Title
			data-slot="toast-title"
			className={cn("text-xs font-medium", className)}
			{...props}
		/>
	);
}

function ToastDescription({
	className,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Description>) {
	return (
		<ToastPrimitive.Description
			data-slot="toast-description"
			className={cn("text-xs text-muted-foreground", className)}
			{...props}
		/>
	);
}

function ToastClose({
	className,
	...props
}: React.ComponentProps<typeof ToastPrimitive.Close>) {
	return (
		<ToastPrimitive.Close
			data-slot="toast-close"
			aria-label="Close"
			className={cn(
				"text-muted-foreground hover:text-foreground absolute right-2 top-2 inline-flex size-5 items-center justify-center transition-colors",
				className,
			)}
			{...props}
		>
			<HugeiconsIcon
				icon={CancelCircleIcon}
				strokeWidth={2}
				aria-hidden="true"
			/>
		</ToastPrimitive.Close>
	);
}

export {
	ToastProvider,
	ToastViewport,
	Toast,
	ToastTitle,
	ToastDescription,
	ToastClose,
};

export type { ToastVariant };
