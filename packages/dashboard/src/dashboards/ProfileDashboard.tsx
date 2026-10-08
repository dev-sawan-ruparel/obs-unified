import { ConnectedRail } from "../components/ConnectedRail";
import { FlameGraph } from "../components/flame-graph/FlameGraph";

export interface ProfileDashboardProps {
	profileId: string;
	traceIdFilter?: string;
	onNavigate?: (href: string) => void;
}

export function ProfileDashboard({
	profileId,
	traceIdFilter,
	onNavigate,
}: ProfileDashboardProps) {
	return (
		<div className="flex h-full min-h-0 bg-sys-bg">
			<div className="min-w-0 flex-1 overflow-y-auto p-3">
				<FlameGraph
					profileId={profileId}
					traceIdFilter={traceIdFilter}
					title="Profile flame graph"
				/>
			</div>
			<ConnectedRail
				entityKind="profile"
				entityId={profileId}
				onNavigate={onNavigate}
			/>
		</div>
	);
}
