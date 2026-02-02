import type { ReactElement } from "react";
import type { PreviewKind } from "@/components/app/previews/types";
import type { SessionFsFilePreviewResponse } from "@/lib/api";

export type PreviewRenderer = (
	payload: SessionFsFilePreviewResponse,
	sessionId?: string,
) => ReactElement;

export type PreviewRendererRegistry = Record<PreviewKind, PreviewRenderer>;
