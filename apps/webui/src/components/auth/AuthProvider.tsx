import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useState,
} from "react";
import {
	isAuthEnabled,
	signIn,
	signOut,
	signUp,
	updateCachedToken,
	useSession,
} from "@/lib/auth";

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
	sessionToken: string | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

type AuthProviderProps = {
	children: ReactNode;
};

export function AuthProvider({ children }: AuthProviderProps) {
	const session = useSession();
	const [sessionToken, setSessionToken] = useState<string | null>(null);

	// Extract user from session
	const user = session.data?.user
		? {
				id: session.data.user.id,
				email: session.data.user.email,
				name: session.data.user.name ?? undefined,
				image: session.data.user.image ?? undefined,
			}
		: null;

	// Update session token when session changes
	useEffect(() => {
		const token = session.data?.session?.token ?? null;
		setSessionToken(token);
		updateCachedToken(token);
	}, [session.data?.session?.token]);

	const handleSignOut = async () => {
		await signOut();
		setSessionToken(null);
		updateCachedToken(null);
	};

	const value: AuthContextValue = {
		user,
		isLoading: session.isPending,
		isAuthenticated: !!user,
		isAuthEnabled: isAuthEnabled(),
		signIn,
		signUp,
		signOut: handleSignOut,
		sessionToken,
	};

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const context = useContext(AuthContext);
	if (!context) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
