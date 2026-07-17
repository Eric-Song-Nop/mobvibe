import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@mobvibe/ui/alert-dialog";
import { Button } from "@mobvibe/ui/button";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentAuthentication } from "@/hooks/useAgentAuthentication";

export type AgentAuthenticationPanelProps = {
	backendId?: string;
	enabled: boolean;
	machineId?: string;
};

type LogoutTarget = {
	backendId: string;
	machineId: string;
};

function LoadingIndicator() {
	return (
		<span
			aria-hidden="true"
			className="border-muted-foreground/40 border-t-foreground size-3 shrink-0 animate-spin rounded-full border-2"
		/>
	);
}

export function AgentAuthenticationPanel({
	backendId,
	enabled,
	machineId,
}: AgentAuthenticationPanelProps) {
	const { t } = useTranslation();
	const [logoutTarget, setLogoutTarget] = useState<LogoutTarget | null>(null);
	const {
		actionError,
		actionKind,
		actionMethodId,
		actionSucceeded,
		authenticate,
		capabilities,
		capabilitiesQuery,
		isActionPending,
		logout,
	} = useAgentAuthentication({ backendId, enabled, machineId });

	if (!enabled || !machineId || !backendId) {
		return null;
	}

	const titleId = "agent-authentication-title";
	const descriptionId = "agent-authentication-description";
	const logoutDescriptionId = "agent-authentication-logout-description";
	const hasActionFeedback = Boolean(actionError || actionSucceeded);

	if (capabilitiesQuery.isPending && !capabilities) {
		return (
			<output
				className="border-border bg-muted/20 text-muted-foreground flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-xs"
				aria-live="polite"
			>
				<LoadingIndicator />
				<span>{t("session.agentAuthentication.checking")}</span>
			</output>
		);
	}

	if (capabilitiesQuery.isError && !capabilities) {
		return (
			<section
				aria-labelledby={titleId}
				className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3"
			>
				<h3 id={titleId} className="text-sm font-medium">
					{t("session.agentAuthentication.title")}
				</h3>
				<output
					className="text-destructive block text-xs text-pretty"
					aria-live="polite"
				>
					{t("session.agentAuthentication.loadError")}
				</output>
				<div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void capabilitiesQuery.refetch()}
					>
						{t("common.retry")}
					</Button>
				</div>
			</section>
		);
	}

	if (!capabilities && !hasActionFeedback) {
		return null;
	}

	const actionStatus = actionError
		? t("session.agentAuthentication.actionError")
		: actionSucceeded
			? actionKind === "logout"
				? t("session.agentAuthentication.logoutComplete")
				: t("session.agentAuthentication.authenticateComplete")
			: undefined;
	const logoutDialogOpen =
		logoutTarget?.machineId === machineId &&
		logoutTarget.backendId === backendId;
	const actionsDisabled = isActionPending || capabilitiesQuery.isFetching;

	return (
		<>
			<section
				aria-labelledby={titleId}
				aria-describedby={descriptionId}
				aria-busy={isActionPending || capabilitiesQuery.isFetching}
				className="border-border bg-muted/20 flex min-w-0 flex-col gap-3 rounded-md border p-3"
			>
				<div className="flex min-w-0 flex-col gap-1">
					<h3 id={titleId} className="text-sm font-medium">
						{t("session.agentAuthentication.title")}
					</h3>
					<p
						id={descriptionId}
						className="text-muted-foreground text-xs text-pretty"
					>
						{t("session.agentAuthentication.description")}
					</p>
				</div>

				{capabilities?.methods.length ? (
					<div className="grid min-w-0 gap-2 sm:grid-cols-2">
						{capabilities.methods.map((method) => {
							const isStartingMethod =
								isActionPending &&
								actionKind === "authenticate" &&
								actionMethodId === method.id;
							return (
								<Button
									key={method.id}
									type="button"
									variant="outline"
									className="h-auto min-h-10 min-w-0 w-full justify-start whitespace-normal px-3 py-2 text-left"
									disabled={actionsDisabled}
									onClick={() => authenticate(method.id)}
								>
									{isStartingMethod ? <LoadingIndicator /> : null}
									<span className="flex min-w-0 flex-col items-start gap-0.5">
										<span className="break-words">
											{isStartingMethod
												? t("session.agentAuthentication.authenticating")
												: t("session.agentAuthentication.authenticate", {
														name: method.name,
													})}
										</span>
										{method.description ? (
											<span className="text-muted-foreground break-words text-[11px] font-normal">
												{method.description}
											</span>
										) : null}
									</span>
								</Button>
							);
						})}
					</div>
				) : null}

				{capabilities?.logout ? (
					<div className="border-border flex min-w-0 flex-col gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
						<p
							id={logoutDescriptionId}
							className="text-muted-foreground min-w-0 text-xs text-pretty"
						>
							{t("session.agentAuthentication.logoutImpact")}
						</p>
						<Button
							type="button"
							variant="outline"
							className="min-h-10 w-full shrink-0 sm:w-auto"
							aria-describedby={logoutDescriptionId}
							disabled={actionsDisabled}
							onClick={() => setLogoutTarget({ backendId, machineId })}
						>
							{isActionPending && actionKind === "logout" ? (
								<LoadingIndicator />
							) : null}
							{isActionPending && actionKind === "logout"
								? t("session.agentAuthentication.loggingOut")
								: t("session.agentAuthentication.logout")}
						</Button>
					</div>
				) : null}

				{actionStatus ? (
					<output
						className={
							actionError
								? "text-destructive text-xs text-pretty"
								: "text-muted-foreground text-xs text-pretty"
						}
						aria-live="polite"
					>
						{actionStatus}
					</output>
				) : null}
			</section>

			<AlertDialog
				open={logoutDialogOpen}
				onOpenChange={(open) => {
					if (!open) {
						setLogoutTarget(null);
					}
				}}
			>
				<AlertDialogContent size="sm" className="overscroll-contain">
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("session.agentAuthentication.logoutTitle")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t("session.agentAuthentication.logoutDescription")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							onClick={() => {
								setLogoutTarget(null);
								logout();
							}}
						>
							{t("session.agentAuthentication.logoutConfirm")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
