import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";
import { isAuthEnabled, signIn, signOut, signUp, useSession } from "@/lib/auth";

type User = {
	id: string;
	email: string;
	name?: string;
	image?: string;
};

type AuthContextValue = {
	user: User | null;
	isLoading: boolean;
	isAuthenticated: boolean;
	isAuthEnabled: boolean;
	signIn: typeof signIn;
	signUp: typeof signUp;
	signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = {
	children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
	const session = useSession();
	// Extract user from session
	const user = session.data?.user
		? {
				id: session.data.user.id,
				email: session.data.user.email,
				name: session.data.user.name ?? undefined,
				image: session.data.user.image ?? undefined,
			}
		: null;

	const handleSignOut = useCallback(async () => {
		await signOut();
	}, []);

	const value = useMemo<AuthContextValue>(
		() => ({
			user,
			isLoading: session.isPending,
			isAuthenticated: !!user,
			isAuthEnabled: isAuthEnabled(),
			signIn,
			signUp,
			signOut: handleSignOut,
		}),
		[handleSignOut, user, session.isPending],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
