import { useState } from "react";
import { useTimeWindowHours } from "../provider";
import { SessionsView } from "./ai/SessionsView";
import { SpansView } from "./ai/SpansView";
import type { View } from "./ai/Toolbar";

// ── Entry ──────────────────────────────────────────────────────────────────

export interface AIDashboardProps {
	/** Call to pre-select (from `#/ai/calls/<id>`). */
	initialCallId?: string;
}

export function AIDashboard({ initialCallId }: AIDashboardProps = {}) {
	const [view, setView] = useState<View>("spans");
	const hours = String(useTimeWindowHours());

	return (
		<div className="flex h-full flex-col overflow-hidden bg-sys-bg font-sans text-sys-on-surface">
			{view === "sessions" ? (
				<SessionsView hours={hours} view={view} setView={setView} />
			) : (
				<SpansView
					hours={hours}
					view={view}
					setView={setView}
					initialCallId={initialCallId}
				/>
			)}
		</div>
	);
}
