import { MainLayout } from "@/app/MainLayout";
import { useMainAppController } from "@/app/use-main-app-controller";

export function MainApp() {
	const controller = useMainAppController();

	return <MainLayout controller={controller} />;
}
