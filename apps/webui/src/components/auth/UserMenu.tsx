import { Key01Icon, Settings02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function UserMenu() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { user, isAuthEnabled, signOut } = useAuth();

	// Don't show menu if auth is disabled
	if (!isAuthEnabled) {
		return null;
	}

	// Not logged in - show login button (shouldn't happen as app redirects)
	if (!user) {
		return null;
	}

	const initials = user.name
		? user.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: user.email.slice(0, 2).toUpperCase();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button variant="outline" size="icon-sm" className="shrink-0">
					{user.image ? (
						<img
							src={user.image}
							alt={user.name ?? user.email}
							className="h-full w-full rounded-sm object-cover"
						/>
					) : (
						<span className="text-[10px] font-medium">{initials}</span>
					)}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[200px]">
				<DropdownMenuLabel className="font-normal">
					<div className="flex flex-col gap-1">
						{user.name && <p className="text-sm font-medium">{user.name}</p>}
						<p className="text-xs text-muted-foreground">{user.email}</p>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => navigate("/api-keys")}>
					<HugeiconsIcon icon={Key01Icon} className="mr-2 h-4 w-4" />
					API Keys
				</DropdownMenuItem>
				<DropdownMenuItem onClick={() => navigate("/settings")}>
					<HugeiconsIcon icon={Settings02Icon} className="mr-2 h-4 w-4" />
					{t("auth.settings")}
				</DropdownMenuItem>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					onClick={() => {
						signOut();
					}}
				>
					{t("auth.signOut")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
