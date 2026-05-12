import { useBetterAuthTauri } from "@daveyplate/better-auth-tauri/react";
import { BrandLogo } from "@mobvibe/ui/brand-logo";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { MainApp } from "@/app/MainApp";
import { useAuth } from "@/components/auth/AuthProvider";
import { parsePairingUrl } from "@/components/settings/E2EESettings";
import type { SessionsResponse } from "@/lib/api";
import { getAuthClient, isInTauri } from "@/lib/auth";
import { useChatStore } from "@/lib/chat-store";
import { e2ee } from "@/lib/e2ee";

const SettingsPage = lazy(async () => {
	const module = await import("@/pages/SettingsPage");
	return { default: module.SettingsPage };
});

const LoginPage = lazy(async () => {
	const module = await import("@/pages/LoginPage");
	return { default: module.LoginPage };
});

const LegalPage = lazy(async () => {
	const module = await import("@/pages/LegalPage");
	return { default: module.LegalPage };
});

function TauriAuthHandler({
	authClient,
}: {
	authClient: NonNullable<ReturnType<typeof getAuthClient>>;
}) {
	useBetterAuthTauri({
		authClient,
		scheme: "mobvibe",
		onSuccess: (url) => {
			if (url) {
				window.location.href = url;
			}
		},
	});
	return null;
}

function TauriPairHandler() {
	const unlistenRef = useRef<(() => void) | null>(null);
	const queryClientRef = useRef(useQueryClient());

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				const { onOpenUrl } = await import("@tauri-apps/plugin-deep-link");
				const unlisten = await onOpenUrl((urls) => {
					for (const url of urls) {
						const secret = parsePairingUrl(url);
						if (secret) {
							void e2ee.setPairedSecret(secret).then(() => {
								// Unwrap DEKs for all known sessions after pairing.
								const cached =
									queryClientRef.current.getQueryData<SessionsResponse>([
										"sessions",
									]);
								if (cached?.sessions) {
									e2ee.unwrapAllSessionDeks(cached.sessions);
									const { setSessionE2EEStatus } = useChatStore.getState();
									for (const session of cached.sessions) {
										setSessionE2EEStatus(
											session.sessionId,
											e2ee.getSessionE2EEStatus(
												session.sessionId,
												Boolean(session.wrappedDek),
											),
										);
									}
								}
							});
							break;
						}
					}
				});
				if (cancelled) {
					unlisten();
				} else {
					unlistenRef.current = unlisten;
				}
			} catch {
				// Deep-link plugin is unavailable in browser builds.
			}
		})();

		return () => {
			cancelled = true;
			unlistenRef.current?.();
		};
	}, []);

	return null;
}

function LoadingState() {
	const { t } = useTranslation();

	return (
		<div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-muted/40">
			<BrandLogo
				alt="Mobvibe"
				className="size-10 animate-pulse"
				fetchPriority="high"
			/>
			<span className="text-muted-foreground text-sm">
				{t("common.loading")}
			</span>
		</div>
	);
}

function RoutePending() {
	return <LoadingState />;
}

export function AppRoutes() {
	const { isAuthenticated, isLoading, isAuthEnabled } = useAuth();
	const navigate = useNavigate();

	const authClient = getAuthClient();
	const shouldSetupTauriAuth = isInTauri() && authClient !== null;
	const shouldSetupTauriPair = isInTauri();

	if (isLoading) {
		return <LoadingState />;
	}

	return (
		<>
			{shouldSetupTauriAuth && <TauriAuthHandler authClient={authClient!} />}
			{shouldSetupTauriPair && <TauriPairHandler />}
			<Routes>
				<Route
					path="/privacy"
					element={
						<Suspense fallback={<RoutePending />}>
							<LegalPage documentId="privacy" />
						</Suspense>
					}
				/>
				<Route
					path="/terms"
					element={
						<Suspense fallback={<RoutePending />}>
							<LegalPage documentId="terms" />
						</Suspense>
					}
				/>
				<Route
					path="/refund"
					element={
						<Suspense fallback={<RoutePending />}>
							<LegalPage documentId="refund" />
						</Suspense>
					}
				/>
				<Route
					path="/settings"
					element={
						!isAuthEnabled || isAuthenticated ? (
							<Suspense fallback={<RoutePending />}>
								<SettingsPage />
							</Suspense>
						) : (
							<Navigate to="/login?returnUrl=/settings" replace />
						)
					}
				/>
				<Route
					path="/login"
					element={
						isAuthenticated || !isAuthEnabled ? (
							<Navigate to="/" replace />
						) : (
							<Suspense fallback={<RoutePending />}>
								<LoginPage
									onSuccess={() => {
										const params = new URLSearchParams(window.location.search);
										const returnUrl = params.get("returnUrl");
										if (
											returnUrl?.startsWith("/") &&
											!returnUrl.startsWith("//")
										) {
											navigate(returnUrl);
										} else {
											navigate("/");
										}
									}}
								/>
							</Suspense>
						)
					}
				/>
				<Route
					path="/*"
					element={
						!isAuthEnabled || isAuthenticated ? (
							<MainApp />
						) : (
							<Navigate to="/login" replace />
						)
					}
				/>
			</Routes>
		</>
	);
}
